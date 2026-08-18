// SessionStore interface: save/search/resume for session-scoped storage.
// Seam 4 from atomcode-kernel-split-architecture research.
// Implementation uses SQLite+FTS5; interface is port for dependency injection.

import type { NormalizedResult } from "@anysearch/retriever";

export interface Session {
  id: string;
  domain: string;
  createdAt: string;
}

export interface Message {
  role: "user" | "assistant" | "tool";
  content: string;
}

export interface MemoryHit {
  rowid: number;
  sessionId: string;
  role: string;
  content: string;
  rank: number; // FTS5 bm25 rank
}

export interface ResumeAnchor {
  id: number;
  sessionId: string;
  anchorType: string;
  payload: unknown;
  createdAt: string;
}

// Port interface: kernel imports this, CLI composition root injects implementation.
export interface SessionStore {
  createSession(domain: string): Promise<Session>;
  append(sessionId: string, message: Message): Promise<void>;
  searchFts5(sessionId: string | null, query: string, limit?: number): Promise<MemoryHit[]>;
  saveResults(sessionId: string, results: NormalizedResult[]): Promise<void>;
  saveAnchor(sessionId: string, anchorType: string, payload: unknown): Promise<void>;
  getAnchors(sessionId: string): Promise<ResumeAnchor[]>;
}