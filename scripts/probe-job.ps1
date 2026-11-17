# A Windows job owns the probe before its first instruction runs. Descendants
# remain in the job even if their immediate parent exits or closes its pipes.
param([string]$NodeExe, [string]$Payload, [int]$TimeoutMs, [string]$ReceiptPath)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
#pragma warning disable 0649 // Native calls populate the interop structure fields.

public static class AnySearchProbeJob {
    [StructLayout(LayoutKind.Sequential)] struct BasicLimits {
        public long ProcessTime, JobTime;
        public uint Flags;
        public UIntPtr MinWorkingSet, MaxWorkingSet;
        public uint ActiveLimit;
        public UIntPtr Affinity;
        public uint Priority, Scheduling;
    }
    [StructLayout(LayoutKind.Sequential)] struct IoCounters {
        public ulong ReadOps, WriteOps, OtherOps, ReadBytes, WriteBytes, OtherBytes;
    }
    [StructLayout(LayoutKind.Sequential)] struct Limits {
        public BasicLimits Basic;
        public IoCounters Io;
        public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory;
    }
    [StructLayout(LayoutKind.Sequential)] struct Accounting {
        public long UserTime, KernelTime, PeriodUserTime, PeriodKernelTime;
        public uint Faults, TotalProcesses, ActiveProcesses, TerminatedProcesses;
    }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct Startup {
        public uint Size;
        public string Reserved, Desktop, Title;
        public uint X, Y, Width, Height, XChars, YChars, Fill, Flags;
        public ushort Show, ReservedSize;
        public IntPtr ReservedBytes, Input, Output, Error;
    }
    [StructLayout(LayoutKind.Sequential)] struct ProcessInfo {
        public IntPtr Process, Thread;
        public uint ProcessId, ThreadId;
    }
    public sealed class Result { public uint ExitCode; public bool TimedOut; }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern IntPtr CreateJobObject(IntPtr security, string name);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool SetInformationJobObject(IntPtr job, int kind, ref Limits info, uint size);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool QueryInformationJobObject(IntPtr job, int kind, out Accounting info, uint size, IntPtr returned);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool TerminateJobObject(IntPtr job, uint code);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool TerminateProcess(IntPtr process, uint code);
    [DllImport("kernel32.dll", SetLastError = true)] static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll", SetLastError = true)] static extern uint WaitForSingleObject(IntPtr handle, uint ms);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetExitCodeProcess(IntPtr process, out uint code);
    [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int kind);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool CreateProcess(string app, StringBuilder command, IntPtr processSecurity,
        IntPtr threadSecurity, bool inherit, uint flags, IntPtr environment, string cwd,
        ref Startup startup, out ProcessInfo info);

    static void Require(bool ok) { if (!ok) throw new Win32Exception(Marshal.GetLastWin32Error()); }
    static string Quote(string value) {
        var output = new StringBuilder("\"");
        int slashes = 0;
        foreach (char ch in value) {
            if (ch == '\\') { slashes++; continue; }
            output.Append('\\', ch == '"' ? slashes * 2 + 1 : slashes);
            output.Append(ch);
            slashes = 0;
        }
        return output.Append('\\', slashes * 2).Append('"').ToString();
    }
    public static Result Run(string executable, string[] args, int timeoutMs) {
        IntPtr job = CreateJobObject(IntPtr.Zero, null);
        Require(job != IntPtr.Zero);
        var info = new ProcessInfo();
        bool assigned = false;
        try {
            var limits = new Limits();
            limits.Basic.Flags = 0x2000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
            Require(SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf(typeof(Limits))));
            var command = new StringBuilder(Quote(executable));
            foreach (string arg in args) command.Append(' ').Append(Quote(arg));
            var startup = new Startup();
            startup.Size = (uint)Marshal.SizeOf(typeof(Startup));
            startup.Flags = 0x100; // STARTF_USESTDHANDLES
            startup.Input = GetStdHandle(-10);
            startup.Output = GetStdHandle(-11);
            startup.Error = GetStdHandle(-12);
            // CREATE_SUSPENDED prevents a fast probe from spawning before job ownership.
            Require(CreateProcess(executable, command, IntPtr.Zero, IntPtr.Zero, true, 0x08000004,
                IntPtr.Zero, null, ref startup, out info));
            Require(AssignProcessToJobObject(job, info.Process));
            assigned = true;
            Require(ResumeThread(info.Thread) != UInt32.MaxValue);
            uint wait = WaitForSingleObject(info.Process, (uint)timeoutMs);
            if (wait != 0 && wait != 258) throw new Win32Exception(Marshal.GetLastWin32Error());
            uint exitCode;
            Require(GetExitCodeProcess(info.Process, out exitCode));
            Require(TerminateJobObject(job, 1));
            var clock = Stopwatch.StartNew();
            while (true) {
                Accounting state;
                Require(QueryInformationJobObject(job, 1, out state, (uint)Marshal.SizeOf(typeof(Accounting)), IntPtr.Zero));
                if (state.ActiveProcesses == 0) break;
                if (clock.ElapsedMilliseconds >= 5000) throw new Exception("probe job did not become empty");
                Thread.Sleep(10);
            }
            return new Result { ExitCode = exitCode, TimedOut = wait == 258 };
        } finally {
            // The suspended root cannot have descendants before assignment succeeds.
            if (!assigned && info.Process != IntPtr.Zero) TerminateProcess(info.Process, 1);
            CloseHandle(job);
            if (info.Thread != IntPtr.Zero) CloseHandle(info.Thread);
            if (info.Process != IntPtr.Zero) CloseHandle(info.Process);
        }
    }
}
'@
try {
    [string[]]$ProbeArgs = @([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Payload)) | ConvertFrom-Json)
    $Result = [AnySearchProbeJob]::Run($NodeExe, $ProbeArgs, $TimeoutMs)
    # Keep control data separate from arbitrary probe stderr, including a final
    # message without a newline. The job is empty before this receipt is written.
    $Json = @{ status = $Result.ExitCode; timedOut = $Result.TimedOut } | ConvertTo-Json -Compress
    [IO.File]::WriteAllText($ReceiptPath, $Json, [Text.UTF8Encoding]::new($false))
    exit 0
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
