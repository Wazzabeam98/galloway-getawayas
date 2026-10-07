'use client';

import { createContext, useContext } from 'react';

// The experience editor turns this on for everything inside it: every sheet
// opens as one full screen in the add flow's style (WizardShell, single) — the
// big question at the top, close X top left, Save bottom right — and the
// shared controls (Field, OptionPills, Stepper, the Save buttons) take their
// large forms. The holiday-let editor leaves it off and keeps its sheets.
// Its own module so EditorPanel, the wizard kit and the controls can all read
// it without importing each other.
export const QuestionSheetContext = createContext(false);
export const useQuestionSheets = () => useContext(QuestionSheetContext);
