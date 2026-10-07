'use client';

import { useState } from 'react';
import AutoTextarea from '@/components/AutoTextarea';
import { EditorCard, EditorPanel, PanelSave, saved } from '@/components/listing-editor/EditorPanel';
import { wizardAreaCls } from '@/components/services/wizardKit';

// The description as a raised card, like every other part of the editor: the
// opening of it on the card, the whole text in the sheet. Its Save writes the
// listing.
export default function DescriptionCard({ description, onSave }: { description: string; onSave: (description: string) => unknown }) {
    const [open, setOpen] = useState(false);
    const [draft, setDraft] = useState(description);

    return (
        <>
            <EditorCard title="Description" summary={description.trim() || 'Add a description'} onClick={() => { setDraft(description); setOpen(true); }} />
            {open && (
                <EditorPanel title="How would you describe it?" onClose={() => setOpen(false)}
                    footer={<PanelSave onClick={async () => { if (await saved(onSave(draft))) setOpen(false); }} />}>
                    <AutoTextarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={8}
                        aria-label="Description" className={wizardAreaCls} />
                </EditorPanel>
            )}
        </>
    );
}
