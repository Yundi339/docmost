// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { generateHTML, generateJSON } from "@tiptap/html";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import StarterKit from "@tiptap/starter-kit";
import Collaboration from "@tiptap/extension-collaboration";
import * as Y from "yjs";
import { yUndoPluginKey } from "@tiptap/y-tiptap";
import { Heading, htmlToMarkdown, TiptapImage } from "@docmost/editor-ext";

const StaticImage = TiptapImage.extend({
  addNodeView() {
    return undefined;
  },
});
const staticExtensions = [
  Document,
  Paragraph,
  Text,
  Heading.configure({ levels: [1, 2, 3, 4, 5, 6] }),
  StaticImage,
];
const editors: Editor[] = [];

afterEach(() => {
  editors.splice(0).forEach((editor) => editor.destroy());
});

describe("editor compatibility", () => {
  it("round-trips H4-H6 through JSON and HTML", () => {
    const document = {
      type: "doc",
      content: [4, 5, 6].map((level) => ({
        type: "heading",
        attrs: { level },
        content: [{ type: "text", text: `Heading ${level}` }],
      })),
    };

    const html = generateHTML(document, staticExtensions);
    expect(html).toContain("<h4");
    expect(html).toContain("<h5");
    expect(html).toContain("<h6");
    expect(generateJSON(html, staticExtensions).content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          attrs: expect.objectContaining({ level: 4 }),
        }),
        expect.objectContaining({
          attrs: expect.objectContaining({ level: 5 }),
        }),
        expect.objectContaining({
          attrs: expect.objectContaining({ level: 6 }),
        }),
      ]),
    );
    expect(htmlToMarkdown(html)).toContain("#### Heading 4");
    expect(htmlToMarkdown(html)).toContain("##### Heading 5");
    expect(htmlToMarkdown(html)).toContain("###### Heading 6");
  });

  it("round-trips image captions in JSON and HTML while parsing legacy images", () => {
    const document = {
      type: "doc",
      content: [
        {
          type: "image",
          attrs: {
            src: "https://example.com/image.png",
            alt: "Architecture diagram",
            caption: "System architecture",
            align: "center",
          },
        },
      ],
    };

    const html = generateHTML(document, staticExtensions);
    expect(html).toContain('data-type="image"');
    expect(html).toContain("<figcaption>System architecture</figcaption>");
    expect(
      generateJSON(html, staticExtensions).content?.[0]?.attrs,
    ).toMatchObject({
      alt: "Architecture diagram",
      caption: "System architecture",
    });

    const legacy = generateJSON(
      '<img src="https://example.com/legacy.png" alt="Legacy">',
      staticExtensions,
    );
    expect(legacy.content?.[0]?.attrs).toMatchObject({
      alt: "Legacy",
      caption: undefined,
    });
  });

  it("degrades captioned images to standard Markdown without losing alt text", () => {
    const markdown = htmlToMarkdown(`
      <figure data-type="image">
        <img src="https://example.com/image.png" alt="Architecture diagram">
        <figcaption>System architecture</figcaption>
      </figure>
    `);

    expect(markdown.trim()).toBe(
      "![Architecture diagram](https://example.com/image.png)",
    );
  });

  it("synchronizes captions through Yjs and keeps collaborative undo history", () => {
    const ydoc = new Y.Doc();
    const extensions = [
      StarterKit.configure({ undoRedo: false }),
      StaticImage,
      Collaboration.configure({
        document: ydoc,
      }),
    ];
    const first = new Editor({ extensions });
    const second = new Editor({ extensions });
    editors.push(first, second);

    first.commands.setContent({
      type: "doc",
      content: [
        ...[4, 5, 6].map((level) => ({
          type: "heading",
          attrs: { level },
          content: [{ type: "text", text: `Synced heading ${level}` }],
        })),
        {
          type: "image",
          attrs: {
            src: "https://example.com/image.png",
            caption: "Initial caption",
          },
        },
      ],
    });
    expect(second.getJSON().content?.slice(0, 3).map((node) => node.attrs?.level)).toEqual([
      4, 5, 6,
    ]);
    expect(second.getJSON().content?.[3]?.attrs?.caption).toBe(
      "Initial caption",
    );
    yUndoPluginKey.getState(first.state).undoManager.stopCapturing();
    let imagePosition = 0;
    first.state.doc.descendants((node, position) => {
      if (node.type.name === "image") imagePosition = position;
    });
    first.commands.setNodeSelection(imagePosition);
    first.commands.setImageCaption("Updated caption");
    expect(second.getJSON().content?.[3]?.attrs?.caption).toBe(
      "Updated caption",
    );

    first.commands.undo();
    expect(first.getJSON().content?.[3]?.attrs?.caption).toBe(
      "Initial caption",
    );
  });
});
