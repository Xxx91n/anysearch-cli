const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const R = 'D:\\Aworker\\anysearch-cli';
const evDir = path.join(R, '.scratch', 'grill-round-92', 'evidence');
if (!fs.existsSync(evDir)) {
  fs.mkdirSync(evDir, { recursive: true });
}

const prompt = '请帮我搜索一下 deepseek dsh plugin 的最新功能';
console.log('Running dsh turn with prompt:', prompt);
const t0 = Date.now();

const key = process.env.DEEPSEEK_API_KEY;
const childEnv = { ...process.env, DEEPSEEK_API_KEY: key };

const proc = spawn('dsh', ['--profile', 'r92-smoke', '--json', prompt], {
  cwd: R,
  env: childEnv,
  shell: true
});

let stdout = '';
let stderr = '';

proc.stdout.on('data', d => {
  stdout += d.toString('utf8');
});

proc.stderr.on('data', d => {
  stderr += d.toString('utf8');
});

proc.on('close', code => {
  console.log('Turn closed with exit code:', code, 'in', (Date.now() - t0), 'ms');
  console.log('stdout lines:', stdout.split('\n').length);
  console.log('stderr len:', stderr.length);

  // Write transcript
  fs.writeFileSync(path.join(evDir, 't2-transcript.jsonl'), stdout, 'utf8');
  fs.writeFileSync(path.join(evDir, 't2-stderr.log'), stderr, 'utf8');

  // Let's inspect stdout for any ans_* tools or model-request
  const lines = stdout.split('\n').filter(Boolean);
  let modelRequestFound = false;
  let ansToolsFound = [];
  let toolCallsFound = [];
  let errors = [];

  for (const l of lines) {
    try {
      const parsed = JSON.parse(l);
      if (parsed.type === 'error' || parsed.error) {
        errors.push(parsed);
      }
      const str = JSON.stringify(parsed);
      if (str.includes('ans_')) {
        for (const t of ['ans_search_web', 'ans_recall_memory', 'ans_query_knowledge', 'ans_research_web', 'ans_chat']) {
          if (str.includes(t) && !ansToolsFound.includes(t)) {
            ansToolsFound.push(t);
          }
        }
      }
      if (str.includes('tool_call') || parsed.toolCall || (parsed.choices && parsed.choices[0]?.message?.tool_calls)) {
        toolCallsFound.push(parsed);
      }
    } catch (e) {
      // not JSON line
    }
  }

  console.log('Errors found in transcript:', errors.length, errors.slice(0, 3));
  console.log('ans_* tools mentioned in transcript:', ansToolsFound);
  console.log('Tool calls events found:', toolCallsFound.length);
  if (stderr.length > 0) {
    console.log('stderr sample:\n' + stderr.slice(0, 1000));
  }
});
