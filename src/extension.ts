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

    context.subscriptions.push(commands.registerCommand('readabilitycheck.clickStatusBar', () => {
        readabilityCheck.updateReadability();
        //TODO: maybe set warn level here, enable/disable warnings, etc?
        // commands.executeCommand('workbench.action.quickOpen', '> ReadabilityCheck: ');
    }))
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
            this._statusBarItem.command = 'readabilitycheck.clickStatusBar';
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
            let sentenceFunction = this._getAutomatedReadabilitySentence;
            let docFunction = this._getAutomatedReadabilityDoc;

            switch (configuredFormula) {
                case 'flesch':
                    formula = 'Flesch Reading Ease';
                    sentenceFunction = this._getFleschSentence;
                    docFunction = this._getFleschDoc;
                    break;
                case 'flesch-kincaid':
                    formula = 'Flesch-Kincaid Grade Level';
                    sentenceFunction = this._getFleschKincaidSentence;
                    docFunction = this._getFleschKincaidDoc;
                    break;
                case 'coleman-liau':
                    formula = 'Coleman-Liau Index';
                    sentenceFunction = this._getColemanLiauSentence;
                    docFunction = this._getColemanLiauDoc;
                    break;
                case 'dale-chall':
                    formula = 'Dale-Chall Readability';
                    sentenceFunction = this._getDaleChallSentence;
                    docFunction = this._getDaleChallDoc;
                    break;
                case 'smog':
                    formula = 'SMOG Formula';
                    sentenceFunction = this._getSMOGSentence;
                    docFunction = this._getSMOGDoc;
                    break;
                case 'spache':
                    formula = 'Spache Readability';
                    sentenceFunction = this._getSpacheSentence;
                    docFunction = this._getSpacheDoc;
                    break;
                default:
                    formula = 'Automated Readability';
                    sentenceFunction = this._getAutomatedReadabilitySentence;
                    docFunction = this._getAutomatedReadabilityDoc;
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

    // Calculate readability based on the Automated Readability Index formula
    private _calculateAutomatedReadability(sentences: number, words: number, characters: number): number {
    return (4.71 * (characters / words)) + (0.5 * (words / sentences)) - 21.43;
    }

    public _getAutomatedReadabilitySentence(sentence: string): number {
        const words = this._getWordCount(sentence);
        const characters = this._getCharacterCount(sentence);

        return this._calculateAutomatedReadability(1, words, characters);
    }

    public _getAutomatedReadabilityDoc(docContent: string): number {
        const sentences = this._getSentenceCount(docContent);
        const words = this._getWordCount(docContent);
        const characters = this._getCharacterCount(docContent);

        return Math.ceil(this._calculateAutomatedReadability(sentences, words, characters));
    }

    // Calculate readability based on the Coleman-Liau index formula
    private _calculateColemanLiau(sentences: number, words: number, characters: number): number {
        return (0.0588 * ((characters / words) * 100)) - (0.296 * ((sentences / words) * 100)) - 15.8
    }

    public _getColemanLiauSentence(sentence: string): number {
        const words = this._getWordCount(sentence);
        const characters = this._getCharacterCount(sentence);

        return this._calculateColemanLiau(1, words, characters);
    }

    public _getColemanLiauDoc(docContent: string): number {
        const sentences = this._getSentenceCount(docContent);
        const words = this._getWordCount(docContent);
        const characters = this._getCharacterCount(docContent);

        return Math.round(this._calculateColemanLiau(sentences, words, characters));
    }

    // Calculate readability based on the Dale-Chall Readability Formula
    private _calculateDaleChall(sentences: number, words: number, difficultWordPercentage: number): number {
        let score = (0.1579 * difficultWordPercentage) + (0.0496 * (words / sentences));

        // Account for the raw score offset if the difficult word percentage is above 5%
        score += (difficultWordPercentage > 5) ? 3.6365 : 0;

        return score
    }

    public _getDaleChallSentence(sentence: string): number {
        const words = this._getWordCount(sentence);
        const difficultWordCount = this._getDifficultWordCount(sentence, 'dale-chall');
        const difficultWordPercentage = (difficultWordCount / words) * 100;

        return this._calculateDaleChall(1, words, difficultWordPercentage);
    }

    public _getDaleChallDoc(docContent: string): number {
        const sentences = this._getSentenceCount(docContent);
        const words = this._getWordCount(docContent);
        const difficultWordCount = this._getDifficultWordCount(docContent, 'dale-chall');
        const difficultWordPercentage = (difficultWordCount / words) * 100;

        // Return number with up to one decimal point
        return Number(this._calculateDaleChall(sentences, words, difficultWordPercentage).toFixed(1));
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

    // Calculate readability based on the Flesch-Kincaid Grade Level formula
    private _calculateFleschKincaid(sentences: number, words: number, syllables: number): number {
        return (0.39 * (words / sentences)) + (11.8 * (syllables / words)) - 15.59;
    }

    public _getFleschKincaidSentence(sentence: string): number {
        const words = this._getWordCount(sentence);
        const syllables = this._getSyllableCount(sentence);

        return Math.round(this._calculateFleschKincaid(1, words, syllables));
    }

    public _getFleschKincaidDoc(docContent: string): number {
        const sentences = this._getSentenceCount(docContent);
        const words = this._getWordCount(docContent);
        const syllables = this._getSyllableCount(docContent);

        return Math.round(this._calculateFleschKincaid(sentences, words, syllables));
    }

    // Calculate readability based on the Flesch-Kincaid Grade Level formula
    private _calculateSMOG(sentences: number, polysyllables: number): number {
        return 3.1291 + (1.0430 * Math.sqrt(polysyllables * (30 / sentences)));
    }

    public _getSMOGSentence(sentence: string): number {
        const polysyllables = this._getPolysyllabicWordCount(sentence);

        // SMOG needs at least 30 sentences to calculate its score properly...
        //  so we fake it here. I'm not sure if this is actually required.
        return this._calculateSMOG(30, polysyllables * 30)
    }

    public _getSMOGDoc(docContent: string): number {
        const sentences = this._getSentenceCount(docContent);
        const polysyllables = this._getPolysyllabicWordCount(docContent);

        return Math.round(this._calculateSMOG(sentences, polysyllables));
    }

    // Calculate readability based on the Spache Readability Formula
    private _calculateSpache(sentences: number, words: number, difficultWords: number): number {
        return 0.659 + (0.121 * (words / sentences)) + (0.082 * ((difficultWords / words) * 100));
    }

    public _getSpacheSentence(sentence: string): number {
        const words = this._getWordCount(sentence);
        const difficultWords = this._getDifficultWordCount(sentence, 'spache');

        return this._calculateSpache(1, words, difficultWords);
    }

    public _getSpacheDoc(docContent: string): number {
        const sentences = this._getSentenceCount(docContent);
        const words = this._getWordCount(docContent);
        const difficultWords = this._getDifficultWordCount(docContent, 'spache');

        return Math.round(this._calculateSpache(1, words, difficultWords));
    }

    // helper functions
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
            case 'dale-chall':
                var familiarWords = require('dale-chall');
                break;
            case 'spache':
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
        // console.log('Polysyllabic words: ' + polysyllabicWordCount);

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
