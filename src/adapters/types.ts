export interface EditorAdapter {
  readonly editorId: string;
  inject(text: string): Promise<void>;
}
