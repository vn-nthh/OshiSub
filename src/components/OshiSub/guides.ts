// guides.ts — All guide/help content in one place for easy editing.
//
// Each guide has a description and sections.
// Sections have a title and items.
// Items can be:
//   - { text: "plain text" }
//   - { key: "I", text: "Set **in point**" }
//
// Use **bold** in text to highlight keywords (rendered by GuidePopover).

export interface GuideItem {
  key?: string;          // keyboard shortcut (rendered as <kbd>)
  text: string;          // supports **bold** markers
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
    'The transcribe panel generates captions from your video (or cut clips). Choose between local WebGPU inference or the Groq cloud API. Captions can be edited inline after transcription.',
  sections: [
    {
      title: 'Playback',
      items: [
        { text: '**Click a caption row** to seek to that point' },
        { text: 'The active caption is **highlighted** as the video plays' },
        { text: 'Subtitles are **overlaid on the video** in real time' },
      ],
    },
    {
      title: 'Editing',
      items: [
        { text: 'Edit **text** directly in the caption row' },
        { text: 'Edit **timestamps** to adjust timing' },
        { key: 'Shift', text: '+ **Enter** to split a caption at the cursor' },
        { text: 'Hover between rows to **insert** a new caption' },
        { text: 'Click **×** to delete a caption' },
      ],
    },
  ],
};
