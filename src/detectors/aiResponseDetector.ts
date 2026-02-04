import * as vscode from 'vscode';
import * as fs from 'fs';
import { CursorDB } from '../cursor/cursorDB';
import { Bubble } from '../cursor/types';

export class AIResponseDetector {
  private cursorDB: CursorDB;
  private pollingInterval: NodeJS.Timeout | null = null;
  private fileWatcher: vscode.FileSystemWatcher | null = null;
  private isProcessing: boolean = false;
  private lastProcessedBubbleId: string | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;

  constructor(cursorDB: CursorDB) {
    this.cursorDB = cursorDB;
  }

  public startPolling(): void {
    console.log('[AIResponseDetector] Starting polling (5s interval)...');
    
    this.checkForNewResponses();
    
    this.pollingInterval = setInterval(() => {
      this.checkForNewResponses();
    }, 5000);

    this.setupFileWatcher();
  }

  public stopPolling(): void {
    console.log('[AIResponseDetector] Stopping polling...');
    
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }

    if (this.fileWatcher) {
      this.fileWatcher.dispose();
      this.fileWatcher = null;
    }

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  private setupFileWatcher(): void {
    const dbPath = this.cursorDB.getDbPath();
    if (!fs.existsSync(dbPath)) {
      console.log('[AIResponseDetector] DB file not found, skipping file watcher');
      return;
    }

    try {
      const dbUri = vscode.Uri.file(dbPath);
      this.fileWatcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(dbUri, '*')
      );

      this.fileWatcher.onDidChange(() => {
        if (this.debounceTimer) {
          clearTimeout(this.debounceTimer);
        }

        this.debounceTimer = setTimeout(() => {
          console.log('[AIResponseDetector] DB file changed, checking for new responses...');
          this.checkForNewResponses();
        }, 500);
      });

      console.log('[AIResponseDetector] File watcher set up successfully');
    } catch (error) {
      console.error('[AIResponseDetector] Failed to set up file watcher:', error);
    }
  }

  private async checkForNewResponses(): Promise<void> {
    if (this.isProcessing) {
      console.log('[AIResponseDetector] Already processing, skipping...');
      return;
    }

    this.isProcessing = true;

    try {
      await this.cursorDB.initialize();
      
      const latestAIBubble = await this.cursorDB.getLatestAIBubble();

      if (!latestAIBubble) {
        console.log('[AIResponseDetector] No AI bubbles found');
        this.isProcessing = false;
        return;
      }

      if (this.lastProcessedBubbleId === latestAIBubble.bubbleId) {
        console.log('[AIResponseDetector] No new AI responses');
        this.isProcessing = false;
        return;
      }

      console.log(`[AIResponseDetector] ✅ New AI response detected: ${latestAIBubble.bubbleId}`);
      await this.processAIBubble(latestAIBubble);
      
      this.lastProcessedBubbleId = latestAIBubble.bubbleId;

    } catch (error) {
      console.error('[AIResponseDetector] Error checking for new responses:', error);
    } finally {
      this.cursorDB.close();
      this.isProcessing = false;
    }
  }

  private async processAIBubble(bubble: Bubble): Promise<void> {
    console.log('[AIResponseDetector] Processing AI bubble...');
    console.log(`  - Bubble ID: ${bubble.bubbleId}`);
    console.log(`  - Composer ID: ${bubble.composerId}`);
    console.log(`  - Created: ${new Date(bubble.createdAt).toISOString()}`);
    console.log(`  - Text (first 100 chars): ${bubble.text.substring(0, 100)}...`);

    const userBubbles = await this.getUserBubblesForComposer(bubble.composerId);
    if (userBubbles.length > 0) {
      const latestUserBubble = userBubbles[userBubbles.length - 1];
      console.log(`  - User prompt (first 100 chars): ${latestUserBubble.text.substring(0, 100)}...`);
    }

    vscode.window.showInformationMessage(
      `✅ New AI response detected! Bubble ID: ${bubble.bubbleId.substring(0, 8)}...`
    );
  }

  private async getUserBubblesForComposer(composerId: string): Promise<Bubble[]> {
    try {
      const allBubbles = await this.cursorDB.getBubblesForComposer(composerId);
      return allBubbles.filter(b => b.type === 'user');
    } catch (error) {
      console.error('[AIResponseDetector] Failed to get user bubbles:', error);
      return [];
    }
  }

  public getLastProcessedBubbleId(): string | null {
    return this.lastProcessedBubbleId;
  }

  public resetProcessedBubbleId(): void {
    console.log('[AIResponseDetector] Resetting last processed bubble ID');
    this.lastProcessedBubbleId = null;
  }
}
