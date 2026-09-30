/** One checkpoint Claude Code took of a file, just before an edit. */
export interface FileVersion {
  version: number;
  /** When the checkpoint was taken (ms since epoch; 0 when unknown). */
  at: number;
  messageId: string | null;
  /**
   * Absolute path of the blob holding the file's content BEFORE the edit that
   * made this version, or null when the file did not exist yet (Claude created it).
   */
  blob: string | null;
  /** The blob exists on disk (always true when `blob` is null). */
  available: boolean;
}

/** A file Claude changed during one chat, with every checkpoint of it. */
export interface ChangedFile {
  /** Absolute path of the file. */
  path: string;
  /** Base name, for display. */
  name: string;
  /** Sorted by version, ascending, one entry per version. */
  versions: FileVersion[];
  /** The first version has no blob: the file did not exist before Claude wrote it. */
  createdByClaude: boolean;
  /** The file exists now. */
  exists: boolean;
}
