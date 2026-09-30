// Minimal stand-in for the `vscode` module in unit tests. Tests that need
// more behaviour inject fakes through function parameters instead.
export const env = { uriScheme: "vscode", clipboard: { writeText: async (_: string) => {} } };
export const extensions = { getExtension: (_id: string) => undefined };
export const window = {};
export const workspace = { workspaceFolders: undefined };
export const commands = {};
// biome-ignore lint/complexity/noStaticOnlyClass: mirrors vscode.Uri shape
export class Uri {
  static parse(v: string) {
    return { toString: () => v };
  }
}
