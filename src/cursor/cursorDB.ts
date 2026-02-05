import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Composer, Bubble } from './types';

const initSqlJs = require('sql.js');

export class CursorDB {
  private dbPath: string;
  private db: any | null = null;

  constructor() {
    // 플랫폼별 경로 설정
    let appDataPath: string;
    if (process.platform === 'win32') {
      appDataPath = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    } else if (process.platform === 'darwin') {
      // macOS
      appDataPath = path.join(os.homedir(), 'Library', 'Application Support');
    } else {
      // Linux
      appDataPath = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
    }
    this.dbPath = path.join(appDataPath, 'Cursor', 'User', 'globalStorage', 'state.vscdb');
  }

  async initialize(): Promise<void> {
    if (!fs.existsSync(this.dbPath)) {
      throw new Error(`Cursor DB not found at: ${this.dbPath}`);
    }

    const SQL = await initSqlJs();
    const buffer = fs.readFileSync(this.dbPath);
    this.db = new SQL.Database(buffer);

    console.log(`[CursorDB] Initialized successfully: ${this.dbPath}`);
  }

  async getAllComposers(): Promise<Composer[]> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const composers: Composer[] = [];
    const query = `SELECT key, value FROM cursorDiskKV WHERE key LIKE 'composerData:%'`;
    
    try {
      const result = this.db.exec(query);
      
      if (result.length === 0) {
        console.log('[CursorDB] No composers found');
        return composers;
      }

      for (const row of result[0].values) {
        const key = row[0] as string;
        const value = row[1];
        
        if (typeof value !== 'string') continue;
        
        try {
          const data = JSON.parse(value);
          
          const composerId = key.replace('composerData:', '');
          composers.push({
            composerId,
            conversationId: data.conversationId || composerId,
            createdAt: data.createdAt || Date.now(),
            updatedAt: data.updatedAt
          });
        } catch (parseError) {
          console.error(`[CursorDB] Failed to parse composer: ${key}`, parseError);
        }
      }

      console.log(`[CursorDB] Found ${composers.length} composers`);
      return composers;
    } catch (error) {
      console.error('[CursorDB] Failed to get composers:', error);
      throw error;
    }
  }

  async getBubblesForComposer(composerId: string): Promise<Bubble[]> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const bubbles: Bubble[] = [];
    const query = `SELECT key, value FROM cursorDiskKV WHERE key LIKE 'bubbleId:${composerId}:%'`;
    
    try {
      const result = this.db.exec(query);
      
      if (result.length === 0) {
        console.log(`[CursorDB] No bubbles found for composer: ${composerId}`);
        return bubbles;
      }

      for (const row of result[0].values) {
        const key = row[0] as string;
        const value = row[1];
        
        if (typeof value !== 'string') continue;
        
        try {
          const data = JSON.parse(value);
          
          const bubbleId = key.split(':')[2];
          bubbles.push({
            bubbleId,
            composerId,
            type: data.type === 1 ? 'user' : data.type === 2 ? 'assistant' : 'user',
            text: data.text || data.content || '',
            createdAt: data.createdAt || Date.now()
          });
        } catch (parseError) {
          console.error(`[CursorDB] Failed to parse bubble: ${key}`, parseError);
        }
      }

      console.log(`[CursorDB] Found ${bubbles.length} bubbles for composer: ${composerId}`);
      return bubbles;
    } catch (error) {
      console.error(`[CursorDB] Failed to get bubbles for composer ${composerId}:`, error);
      throw error;
    }
  }

  async getLatestAIBubble(): Promise<Bubble | null> {
    const composers = await this.getAllComposers();
    
    if (composers.length === 0) {
      return null;
    }

    composers.sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt));
    
    const latestComposer = composers[0];
    const bubbles = await this.getBubblesForComposer(latestComposer.composerId);
    
    const aiBubbles = bubbles.filter(b => b.type === 'assistant');
    
    if (aiBubbles.length === 0) {
      return null;
    }

    aiBubbles.sort((a, b) => b.createdAt - a.createdAt);
    
    return aiBubbles[0];
  }

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
      console.log('[CursorDB] Database closed');
    }
  }

  getDbPath(): string {
    return this.dbPath;
  }
}
