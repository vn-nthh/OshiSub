// guides.ts — All guide/help content in one place for easy editing.
//
// Each guide has a description and sections.
// Sections have a title and items.
// Items can be:
//   - { text: "plain text" }
//   - { key: "I", text: "Set **in point**" }
//   - { text: "visit [link text](url) for more" }
//
// Use **bold** in text to highlight keywords.
// Use [text](url) for clickable links.

export interface GuideItem {
  key?: string | string[]; // keyboard shortcut(s) (rendered as <kbd>)
  text: string;            // supports **bold** and [text](url)
}

export interface GuideSection {
  title: string;
  items: GuideItem[];
}

export interface Guide {
  description: string;
  sections: GuideSection[];
}

export const cutGuide: Guide = {
  description:
    'The cut panel is used to quickly cut long streams to clips. These clips would then be used to generate transcriptions. If you have no cuts, the whole video would be used.',
  sections: [
    {
      title: 'Navigation',
      items: [
        { key: 'I', text: 'Set **in point**' },
        { key: 'O', text: 'Set **out point**' },
        { text: '**Click** anywhere to move playhead' },
        { text: '**Double-click** to highlight a clip to edit' },
        { text: '**Middle-click drag** to move around the timeline' },
        { text: '**Scroll** to zoom in/out' },
      ],
    },
    {
      title: 'Editing',
      items: [
        { text: 'Edit the **timestamp on the timeline** to make the playhead jump to that point in time (helpful with streams with curated timestamps).' },
        { text: 'Edit the **timestamp of a clip** to change its in/out point.' },
      ],
    },
  ],
};

export const transcribeGuide: Guide = {
  description:
    'The transcribe panel generates captions using your chosen engine.',
  sections: [
    {
      title: 'Engine',
      items: [
        { text: '**WebGPU** — runs on your own machine' },
        { text: '**Groq** — a free cloud service (with limits)' },
        { text: 'To use Groq, go to [console.groq.com](https://console.groq.com), get an API key and paste it into the field — it\'s free, no credit card needed.' },
      ],
    },
    {
      title: 'Playback',
      items: [
        { text: '**Click a caption row** to seek to that point' },
        { text: 'The active caption is **highlighted** as the video plays' },
      ],
    },
    {
      title: 'Editing',
      items: [
        { text: 'Edit **text** directly in the caption row' },
        { text: 'Edit **timestamps** to adjust timing' },
        { key: ['Shift', 'Enter'], text: 'Split a caption at the cursor' },
      ],
    },
  ],
};
