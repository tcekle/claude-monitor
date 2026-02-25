import { Injectable } from '@angular/core';
import { Marked } from 'marked';
import { markedHighlight } from 'marked-highlight';
import hljs from 'highlight.js';

@Injectable({ providedIn: 'root' })
export class MarkdownService {
  private marked: Marked;

  constructor() {
    this.marked = new Marked(
      markedHighlight({
        emptyLangClass: 'hljs',
        langPrefix: 'hljs language-',
        highlight(code, lang) {
          if (lang && hljs.getLanguage(lang)) {
            return hljs.highlight(code, { language: lang }).value;
          }
          return hljs.highlightAuto(code).value;
        },
      }),
    );
  }

  render(markdown: string): string {
    if (!markdown) return '';
    return this.marked.parse(markdown) as string;
  }
}
