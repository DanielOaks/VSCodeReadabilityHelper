'use strict';
// The module 'vscode' contains the VS Code extensibility API
// Import the necessary extensibility types to use in your code below
import {window, workspace, commands, Disposable, languages, Uri, ExtensionContext, StatusBarAlignment, StatusBarItem, TextDocument, CommentThreadCollapsibleState, Diagnostic, DiagnosticCollection, Range, DiagnosticSeverity} from 'vscode';

import {SeamFinder} from './seamFinder';

let diagnosticCollection: DiagnosticCollection;
let diagnosticMap: Map<string, Diagnostic[]>;

// This method is called when your extension is activated. Activation is
// controlled by the activation events defined in package.json.
export function activate(context: ExtensionContext) {

    // Use the console to output diagnostic information (console.log) and errors (console.error).
    // This line of code will only be executed once when your extension is activated.
    console.log('ReadabilityCheck active!');

    // Create the diagnostics (where our warnings for each document live)
    diagnosticCollection = languages.createDiagnosticCollection('ReadabilityCheck Lints');
    diagnosticMap = new Map();

    // Create the readability check
    let readabilityCheck = new ReadabilityCheck();
    let controller = new ReadabilityCheckController(readabilityCheck);

    let disposable = commands.registerCommand('extension.checkReadability', () => {
        readabilityCheck.updateReadability();
    });

    // Add to a list of disposables which are disposed when this extension is deactivated.
    context.subscriptions.push(readabilityCheck);
    context.subscriptions.push(controller);
    context.subscriptions.push(disposable);
    context.subscriptions.push(workspace.onDidCloseTextDocument(event => {
        if (diagnosticMap.has(event.uri.toString())) {
            diagnosticMap.delete(event.uri.toString());
        }
        resetDiagnostics();
    }));
}

function resetDiagnostics() {
    diagnosticCollection.clear();

    diagnosticMap.forEach((diags, file) => {
        diagnosticCollection.set(Uri.parse(file), diags);
    });
}

class ReadabilityCheck {

    private _statusBarItem?: StatusBarItem = undefined;

    public updateReadability() {

        // Create as needed
        if (!this._statusBarItem) {
            this._statusBarItem = window.createStatusBarItem(StatusBarAlignment.Left);
        }

        // Get the current text editor
        let editor = window.activeTextEditor;
        if (!editor) {
            this._statusBarItem.hide();
            return;
        }

        let doc = editor.document;

        // Only update status if a Markdown or plaintext file
        if ((doc.languageId === "markdown") || (doc.languageId === "plaintext")) {
            const config = workspace.getConfiguration();
            const configuredFormula = config.get<string>('readabilityCheck.formula');

            const warningsEnabled = config.get<boolean>('readabilityCheck.warningsEnabled') || false;
            const warnScoreName = `readabilityCheck.warnScore.${configuredFormula}`;
            const warnScore: number = config.get<number>(warnScoreName) || 0;

            let formula = 'Readability';
            let readability = 0;

            const removeMd = require('remove-markdown');
            const rawDocContent = doc.getText();
            const docContent: string = removeMd(rawDocContent);

            // select formula and readability function
            let sentenceFunction = this._getFleschSentence;
            let docFunction = this._getAutomatedReadability;

            switch (configuredFormula) {
                case 'flesch':
                    formula = 'Flesch Reading Ease';
                    docFunction = this._getFleschDoc;
                    break;
                case 'flesch-kincaid':
                    formula = 'Flesch-Kincaid Grade Level';
                    docFunction = this._getFleschKincaid;
                    break;
                case 'coleman-liau':
                    formula = 'Coleman-Liau Index';
                    docFunction = this._getColemanLiau;
                    break;
                case 'dale-chall':
                    formula = 'Dale-Chall Readability';
                    docFunction = this._getDaleChall;
                    break;
                case 'smog':
                    formula = 'SMOG Formula';
                    docFunction = this._getSMOG;
                    break;
                case 'spache':
                    formula = 'Spache Readability';
                    docFunction = this._getSpache;
                    break;
                default:
                    formula = 'Automated Readability';
                    docFunction = this._getAutomatedReadability;
                    break;
            }

            // fix doc and sentence functions
            docFunction = docFunction.bind(this);
            sentenceFunction = sentenceFunction.bind(this)

            readability = docFunction(docContent);

            // should we warn for difficult sentences?
            let shouldWarn = false;
            if (warningsEnabled) {
                if (configuredFormula === 'flesch') {
                    shouldWarn = readability < warnScore;
                } else {
                    shouldWarn = readability > warnScore;
                }
            }

            // let's figure out the most difficult ones
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
                    if (configuredFormula === 'flesch') {
                        sentencesByDifficulty.sort((a, b) => a[0] - b[0]);
                    } else {
                        sentencesByDifficulty.sort((a, b) => b[0] - a[0]);
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
                let diagnostics: Diagnostic[] = [];
                cleanedWarnIndexes.forEach(indexSet => {
                    const realIndexes = sf.lookup(indexSet[0], indexSet[1]);
                    const start = doc.positionAt(realIndexes.start);
                    const end = doc.positionAt(realIndexes.start + realIndexes.length);
                    diagnostics.push(new Diagnostic(new Range(start, end), 'This sentence is difficult to read', DiagnosticSeverity.Warning));
                });

                diagnosticMap.set(doc.uri.toString(), diagnostics);
                resetDiagnostics();
            }

            // Update the status bar
            this._statusBarItem.text = `${formula} score: ${readability}`;
            this._statusBarItem.show();
        } else {
            this._statusBarItem.hide();
        }
    }

    public _getAutomatedReadability(docContent: string): number {
        let autoRead = 0;

        let sentenceCount = this._getSentenceCount(docContent);
        console.log("Sentence count: " + sentenceCount);

        let wordCount = this._getWordCount(docContent);
        console.log("Word count: " + wordCount);

        let charCount = this._getCharacterCount(docContent);
        console.log("Character count: " + charCount);

        // Calculate readability based on the Automated Readability Index formula
        autoRead = (4.71 * (charCount / wordCount)) + (0.5 * (wordCount / sentenceCount)) - 21.43;
        console.log("Calculated Automatic Readability score: " + autoRead);

        // Scores are always rounded up to the nearest integer
        return Math.ceil(autoRead);
    }

    public _getColemanLiau(docContent: string): number {
        let colemanLiauRead = 0;

        let sentenceCount = this._getSentenceCount(docContent);
        console.log("Sentence count: " + sentenceCount);

        let wordCount = this._getWordCount(docContent);
        console.log("Word count: " + wordCount);

        let charCount = this._getCharacterCount(docContent);
        console.log("Syllable count: " + charCount);

        // Calculate readability based on the Coleman-Liau index formula
        colemanLiauRead = (0.0588 * ((charCount / wordCount) * 100)) - (0.296 * ((sentenceCount / wordCount) * 100)) - 15.8
        console.log("Calculated Coleman-Liau index score: " + colemanLiauRead);

        return Math.round(colemanLiauRead);
    }

    public _getDaleChall(docContent: string): number {
        let daleChallRead = 0;

        let sentenceCount = this._getSentenceCount(docContent);
        console.log("Sentence count: " + sentenceCount);

        let wordCount = this._getWordCount(docContent);
        console.log("Word count: " + wordCount);

        let difficultWordCount = this._getDifficultWordCount(docContent, "dale-chall");
        console.log("Difficult word count: " + difficultWordCount);

        let difficultWordPercentage = (difficultWordCount / wordCount) * 100;

        // Calculate readability based on the Dale-Chall Readability Formula
        daleChallRead = (0.1579 * difficultWordPercentage) + (0.0496 * (wordCount / sentenceCount))
        // Account for the raw score offset if the difficult word percentage is above 5%
        daleChallRead += (difficultWordPercentage > 5) ? 3.6365 : 0;
        console.log("Calculated Dale Chall Readability Formula score: " + daleChallRead);

        // Return number with up to one decimal point
        return Number(daleChallRead.toFixed(1));
    }

    // Calculate readability based on the Flesch Readability Ease formula
    private _calculateFlesch(sentences: number, words: number, syllables: number): number {
        return 206.835 - (1.015 * (words / sentences)) - (84.6 * (syllables / words));
    }

    public _getFleschSentence(sentence: string): number {
        const words = this._getWordCount(sentence);
        const syllables = this._getSyllableCount(sentence);

        return this._calculateFlesch(1, words, syllables);
    }

    public _getFleschDoc(docContent: string): number {
        const sentences = this._getSentenceCount(docContent);
        const words = this._getWordCount(docContent);
        const syllables = this._getSyllableCount(docContent);

        return Math.round(this._calculateFlesch(sentences, words, syllables));
    }

    public _getFleschKincaid(docContent: string): number {
        let fleschKincaidRead = 0;

        let sentenceCount = this._getSentenceCount(docContent);
        console.log("Sentence count: " + sentenceCount);

        let wordCount = this._getWordCount(docContent);
        console.log("Word count: " + wordCount);

        let syllableCount = this._getSyllableCount(docContent);
        console.log("Syllable count: " + syllableCount);

        // Calculate readability based on the Flesch-Kincaid Grade Level formula
        fleschKincaidRead = (0.39 * (wordCount / sentenceCount)) + (11.8 * (syllableCount / wordCount)) - 15.59;
        console.log("Calculated Flesch-Kincaid U.S. Grade Level score: " + fleschKincaidRead);

        return Math.round(fleschKincaidRead);
    }

    public _getSMOG(docContent: string): number {
        let SMOGRead = 0;

        let sentenceCount = this._getSentenceCount(docContent);
        console.log("Sentence count: " + sentenceCount);

        let polysyllableCount = this._getPolysyllabicWordCount(docContent);
        console.log("Syllable count: " + polysyllableCount);

        // Calculate readability based on the Flesch-Kincaid Grade Level formula
        SMOGRead = 3.1291 + (1.0430 * Math.sqrt(polysyllableCount * (30 / sentenceCount)));
        console.log("Calculated Simple Measure of Gobbledygook (SMOG) Index score: " + SMOGRead);

        return Math.round(SMOGRead);
    }

    public _getSpache(docContent: string): number {
        let spacheRead = 0;

        let sentenceCount = this._getSentenceCount(docContent);
        console.log("Sentence count: " + sentenceCount);

        let wordCount = this._getWordCount(docContent);
        console.log("Word count: " + wordCount);

        let difficultWordCount = this._getDifficultWordCount(docContent, "spache");
        console.log("Difficult word count: " + difficultWordCount);

        // Calculate readability based on the Dale-Chall Readability Formula
        spacheRead = 0.659 + (0.121 * (wordCount / sentenceCount)) + (0.082 * ((difficultWordCount / wordCount) * 100));
        console.log("Calculated Spache Readability Formula score: " + spacheRead);

        return Math.round(spacheRead);
    }

    public _getWordCount(docContent: string): number {
        let wordCount = 0;
        wordCount = (docContent.match(/\w+/g) || []).length

        return wordCount;
    }
    
    public _getCharacterCount(docContent: string): number {
        // Strip all whitespace characters
        docContent = docContent.replace(/\s+/g, '');

        let charCount = 0;
        charCount = docContent.length;

        return charCount;
    }

    public _getSentenceCount(docContent: string): number {
        // Approximate sentence count by finding word, followed by punctuation (.?!) and whitespace or end of string
        // as well as any words that match : or just a linebreak at the end of an unpunctuated line (eg: lists)
        // TODO: account for Markdown tables?
        let sentenceCount = 0;
        // need to do `|| []` to account for words matching that case not existing
        sentenceCount = (docContent.match(/\w[.?!](\s|$)/g) || []).length + (docContent.match(/\w:?\n/g) || []).length;

        // Return the count if more than zero sentences found, otherwise return 1
        return (sentenceCount > 0 ? sentenceCount : 1);
    }
    
    public _getSyllableCount(docContent: string): number {
        let syllable = require('syllable');        
        let syllableCount = 0;

        syllableCount = syllable(docContent);

        return syllableCount;
    }

        
    public _getDifficultWordCount(docContent: string, vocabulary: string): number {
        switch (vocabulary) {
            case "dale-chall":
                var familiarWords = require('dale-chall');
                break;
            case "spache":
                var familiarWords = require('spache');
                break;
            default:
                return 0;
        }
        
        let difficultWordCount = 0;
        let wordList = Array();

        // Grab words from document
        wordList = docContent.match(/\w+/g) || [];

        for (var i = 0; i < wordList.length; i++) {
            let word = wordList[i];
            difficultWordCount += (familiarWords.indexOf(word) > -1) ? 1 : 0;
        }

        return difficultWordCount;
    }

    public _getPolysyllabicWordCount(docContent: string): number {
        let syllable = require('syllable');       
        let polysyllabicWordCount = 0;
        let wordList = Array();

        // Grab words from document
        wordList = docContent.match(/\w+/g) || [];

        for (var i = 0; i < wordList.length; i++) {
            let word = wordList[i];
            polysyllabicWordCount += (syllable(word) >= 3 ) ? 1 : 0;
        }
        console.log("Polysyllabic words: " + polysyllabicWordCount);

        return polysyllabicWordCount;
    }

    dispose() {
        if (this._statusBarItem) {
            this._statusBarItem.dispose();
        }
    }
}

class ReadabilityCheckController {

    private _readabilityCheck: ReadabilityCheck;
    private _disposable: Disposable;

    constructor(readabilityCheck: ReadabilityCheck) {
        this._readabilityCheck = readabilityCheck;

        // Update the readability counter when the file is opened or saved
        let subscriptions: Disposable[] = [];
        workspace.onDidOpenTextDocument(this._onEvent, this, subscriptions);
        workspace.onDidSaveTextDocument(this._onEvent, this, subscriptions);

        // Update the counter for the current file
        this._readabilityCheck.updateReadability();

        // Create a combined disposable from both event subscriptions
        this._disposable = Disposable.from(...subscriptions);
    }

    dispose() {
        this._disposable.dispose();
    }

    private _onEvent() {
        this._readabilityCheck.updateReadability();
    }
}
