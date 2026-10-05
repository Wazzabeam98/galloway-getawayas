'use client';

import { useState } from 'react';
import { EditorCard, EditorPanel, PanelSave } from '@/components/listing-editor/EditorPanel';

// Airbnb's "Title" card: the current title on a raised card, the field behind
// it. Saves with the listing's main Save.
export default function TitleCard({ title, onSave }: { title: string; onSave: (title: string) => void }) {
    const [open, setOpen] = useState(false);
    const [draft, setDraft] = useState(title);

    return (
        <>
            <EditorCard title="Title" summary={title.trim() || 'Add a title'} onClick={() => { setDraft(title); setOpen(true); }} />
            {open && (
                <EditorPanel title="Title" onClose={() => setOpen(false)}
                    footer={<PanelSave onClick={() => { onSave(draft); setOpen(false); }} />}>
                    <input type="text" value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={80}
                        aria-label="Title" className="w-full p-3 border rounded-xl" />
                </EditorPanel>
            )}
        </>
    );
}
