'use strict';
// The module 'vscode' contains the VS Code extensibility API
// Import the necessary extensibility types to use in your code below
import {window, workspace, commands, Disposable, languages, Uri, ExtensionContext, StatusBarAlignment, StatusBarItem, TextDocument, CommentThreadCollapsibleState, Diagnostic, DiagnosticCollection, Range, DiagnosticSeverity} from 'vscode';

import * as readabilityTests from './readabilityTests';
import {SeamFinder} from './seamFinder';

let diagnosticCollection: DiagnosticCollection;
let diagnosticMap: Map<string, Diagnostic[]>;

// This method is called when your extension is activated. Activation is
// controlled by the activation events defined in package.json.
export function activate(context: ExtensionContext) {

    // Use the console to output diagnostic information (console.log) and errors (console.error).
    // This line of code will only be executed once when your extension is activated.
    console.log('ReadabilityHelper active!');

    // Create the diagnostics (where our warnings for each document live)
    diagnosticCollection = languages.createDiagnosticCollection('ReadabilityHelper Lints');
    diagnosticMap = new Map();

    // Create the readability check
    let readabilityHelper = new ReadabilityHelper();
    let controller = new ReadabilityHelperController(readabilityHelper);

    let disposable = commands.registerCommand('readabilityHelper.checkDoc', () => {
        readabilityHelper.updateReadability();
    });

    // Add to a list of disposables which are disposed when this extension is deactivated.
    context.subscriptions.push(readabilityHelper);
    context.subscriptions.push(controller);
    context.subscriptions.push(disposable);
    context.subscriptions.push(workspace.onDidCloseTextDocument(event => {
        if (diagnosticMap.has(event.uri.toString())) {
            diagnosticMap.delete(event.uri.toString());
        }
        resetDiagnostics();
    }));

    context.subscriptions.push(commands.registerCommand('readabilityHelper.clickStatusBar', () => {
        readabilityHelper.updateReadability();
        //TODO: maybe set warn level here, enable/disable warnings, etc?
        // commands.executeCommand('workbench.action.quickOpen', '> Readability Helper: ');
    }))
}

function resetDiagnostics() {
    diagnosticCollection.clear();

    diagnosticMap.forEach((diags, file) => {
        diagnosticCollection.set(Uri.parse(file), diags);
    });
}

class ReadabilityHelper {

    private _statusBarItem?: StatusBarItem = undefined;

    public updateReadability() {

        // Create as needed
        if (!this._statusBarItem) {
            this._statusBarItem = window.createStatusBarItem(StatusBarAlignment.Left);
            this._statusBarItem.command = 'readabilityHelper.clickStatusBar';
        }

        // Get the current text editor
        let editor = window.activeTextEditor;
        if (!editor) {
            this._statusBarItem.hide();
            return;
        }

        let doc = editor.document;

        // Only update status if a Markdown or plaintext file
        if ((doc.languageId === 'markdown') || (doc.languageId === 'plaintext')) {
            const config = workspace.getConfiguration();
            const configuredFormula = config.get<string>('readabilityHelper.formula');

            const highlightDifficultSentences = config.get<boolean>('readabilityHelper.highlightDifficultSentences') || false;
            const maxDifficultyScoreName = `readabilityHelper.maxDifficultyScore.${configuredFormula}`;
            const maxDifficultyScore: number = config.get<number>(maxDifficultyScoreName) || 0;

            let formula = 'Readability';
            let readability = 0;

            const removeMd = require('remove-markdown');
            const rawDocContent = doc.getText();
            const docContent: string = removeMd(rawDocContent);

            // select formula and readability function
            let sentenceFunction = readabilityTests.getAutomatedReadabilitySentence;
            let docFunction = readabilityTests.getAutomatedReadabilityDoc;
            // this controls how we compare scores to the configured max ones
            let lowerScoreIsEasier = true;

            switch (configuredFormula) {
                case 'flesch':
                    formula = 'Flesch Reading Ease';
                    sentenceFunction = readabilityTests.getFleschSentence;
                    docFunction = readabilityTests.getFleschDoc;
                    lowerScoreIsEasier = false;
                    break;
                case 'flesch-kincaid':
                    formula = 'Flesch-Kincaid Grade Level';
                    sentenceFunction = readabilityTests.getFleschKincaidSentence;
                    docFunction = readabilityTests.getFleschKincaidDoc;
                    break;
                case 'coleman-liau':
                    formula = 'Coleman-Liau Index';
                    sentenceFunction = readabilityTests.getColemanLiauSentence;
                    docFunction = readabilityTests.getColemanLiauDoc;
                    break;
                case 'dale-chall':
                    formula = 'Dale-Chall Readability';
                    sentenceFunction = readabilityTests.getDaleChallSentence;
                    docFunction = readabilityTests.getDaleChallDoc;
                    break;
                case 'smog':
                    formula = 'SMOG Formula';
                    sentenceFunction = readabilityTests.getSMOGSentence;
                    docFunction = readabilityTests.getSMOGDoc;
                    break;
                case 'spache':
                    formula = 'Spache Readability';
                    sentenceFunction = readabilityTests.getSpacheSentence;
                    docFunction = readabilityTests.getSpacheDoc;
                    break;
                default:
                    formula = 'Automated Readability';
                    sentenceFunction = readabilityTests.getAutomatedReadabilitySentence;
                    docFunction = readabilityTests.getAutomatedReadabilityDoc;
                    break;
            }

            // fix doc and sentence functions
            docFunction = docFunction.bind(this);
            sentenceFunction = sentenceFunction.bind(this)

            readability = docFunction(docContent);

            // should we warn for difficult sentences?
            let shouldWarn = false;
            if (highlightDifficultSentences) {
                if (lowerScoreIsEasier) {
                    shouldWarn = readability > maxDifficultyScore;
                } else {
                    shouldWarn = readability < maxDifficultyScore;
                }
            }

            // let's figure out the most difficult ones
            let diagnostics: Diagnostic[] = [];
            if (shouldWarn) {
                console.log("This document isn't very readable ;-;");

                // difficulty score : sentence
                let sentencesByDifficulty: [number, string][] = [];

                // lazy splitting into sentences
                const sentences: string[] = docContent.match(/([^\.!\?]+[\.!\?]+)|([^\.!\?]+$)/g) || [];

                sentences.forEach(sentence => {
                    sentence = sentence.trim();
                    const score = sentenceFunction(sentence);
                    // const score = sentence.length;
                    sentencesByDifficulty.push([score, sentence]);

                    // sort by most difficult to least
                    if (lowerScoreIsEasier) {
                        sentencesByDifficulty.sort((a, b) => b[0] - a[0]);
                    } else {
                        sentencesByDifficulty.sort((a, b) => a[0] - b[0]);
                    }
                    // only keep 3 most difficult sentences
                    while (sentencesByDifficulty.length > 3) {
                        sentencesByDifficulty.pop();
                    }
                });

                let cleanedWarnIndexes: [number, number][] = [];

                sentencesByDifficulty.forEach(data => {
                    const sentence = data[1];
                    let index = docContent.indexOf(sentence);
                    // find and mark repeated instances of the same sentence
                    while (index != -1) {
                        cleanedWarnIndexes.push([index, sentence.length]);
                        index = docContent.indexOf(sentence, index+sentence.length);
                    }
                });
                cleanedWarnIndexes.sort((a, b) => a[0] - b[0]);

                // convert cleaned warn indexes to real ones
                const sf = new SeamFinder(rawDocContent, docContent);

                // add warnings for each set of indexes
                cleanedWarnIndexes.forEach(indexSet => {
                    const realIndexes = sf.lookup(indexSet[0], indexSet[1]);
                    const start = doc.positionAt(realIndexes.start);
                    const end = doc.positionAt(realIndexes.start + realIndexes.length);
                    diagnostics.push(new Diagnostic(new Range(start, end), 'This sentence is difficult to read', DiagnosticSeverity.Warning));
                });
            }
            diagnosticMap.set(doc.uri.toString(), diagnostics);
            resetDiagnostics();

            // Update the status bar
            this._statusBarItem.text = `${formula} score: ${readability}`;
            this._statusBarItem.show();
        } else {
            this._statusBarItem.hide();
        }
    }

    dispose() {
        if (this._statusBarItem) {
            this._statusBarItem.dispose();
        }
    }
}

class ReadabilityHelperController {

    private _readabilityHelper: ReadabilityHelper;
    private _disposable: Disposable;

    constructor(readabilityHelper: ReadabilityHelper) {
        this._readabilityHelper = readabilityHelper;

        // Update the readability counter when the file is opened or saved
        let subscriptions: Disposable[] = [];
        workspace.onDidOpenTextDocument(this._onEvent, this, subscriptions);
        workspace.onDidSaveTextDocument(this._onEvent, this, subscriptions);

        // Update the counter for the current file
        this._readabilityHelper.updateReadability();

        // Create a combined disposable from both event subscriptions
        this._disposable = Disposable.from(...subscriptions);
    }

    dispose() {
        this._disposable.dispose();
    }

    private _onEvent() {
        this._readabilityHelper.updateReadability();
    }
}
