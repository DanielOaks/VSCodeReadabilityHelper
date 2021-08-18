'use strict';

// Calculate readability based on the Automated Readability Index formula
function calculateAutomatedReadability(sentences: number, words: number, characters: number): number {
    return (4.71 * (characters / words)) + (0.5 * (words / sentences)) - 21.43;
}

export function getAutomatedReadabilitySentence(sentence: string): number {
    const words = getWordCount(sentence);
    const characters = getCharacterCount(sentence);

    return calculateAutomatedReadability(1, words, characters);
}

export function getAutomatedReadabilityDoc(docContent: string): number {
    const sentences = getSentenceCount(docContent);
    const words = getWordCount(docContent);
    const characters = getCharacterCount(docContent);

    return Math.ceil(calculateAutomatedReadability(sentences, words, characters));
}

// Calculate readability based on the Coleman-Liau index formula
function calculateColemanLiau(sentences: number, words: number, characters: number): number {
    return (0.0588 * ((characters / words) * 100)) - (0.296 * ((sentences / words) * 100)) - 15.8;
}

export function getColemanLiauSentence(sentence: string): number {
    const words = getWordCount(sentence);
    const characters = getCharacterCount(sentence);

    return calculateColemanLiau(1, words, characters);
}

export function getColemanLiauDoc(docContent: string): number {
    const sentences = getSentenceCount(docContent);
    const words = getWordCount(docContent);
    const characters = getCharacterCount(docContent);

    return Math.round(calculateColemanLiau(sentences, words, characters));
}

// Calculate readability based on the Dale-Chall Readability Formula
function calculateDaleChall(sentences: number, words: number, difficultWordPercentage: number): number {
    let score = (0.1579 * difficultWordPercentage) + (0.0496 * (words / sentences));

    // Account for the raw score offset if the difficult word percentage is above 5%
    score += (difficultWordPercentage > 5) ? 3.6365 : 0;

    return score;
}

export function getDaleChallSentence(sentence: string): number {
    const words = getWordCount(sentence);
    const difficultWordCount = getDifficultWordCount(sentence, 'dale-chall');
    const difficultWordPercentage = (difficultWordCount / words) * 100;

    return calculateDaleChall(1, words, difficultWordPercentage);
}

export function getDaleChallDoc(docContent: string): number {
    const sentences = getSentenceCount(docContent);
    const words = getWordCount(docContent);
    const difficultWordCount = getDifficultWordCount(docContent, 'dale-chall');
    const difficultWordPercentage = (difficultWordCount / words) * 100;

    // Return number with up to one decimal point
    return Number(calculateDaleChall(sentences, words, difficultWordPercentage).toFixed(1));
}

// Calculate readability based on the Flesch Readability Ease formula
function calculateFlesch(sentences: number, words: number, syllables: number): number {
    return 206.835 - (1.015 * (words / sentences)) - (84.6 * (syllables / words));
}

export function getFleschSentence(sentence: string): number {
    const words = getWordCount(sentence);
    const syllables = getSyllableCount(sentence);

    return calculateFlesch(1, words, syllables);
}

export function getFleschDoc(docContent: string): number {
    const sentences = getSentenceCount(docContent);
    const words = getWordCount(docContent);
    const syllables = getSyllableCount(docContent);

    return Math.round(calculateFlesch(sentences, words, syllables));
}

// Calculate readability based on the Flesch-Kincaid Grade Level formula
function calculateFleschKincaid(sentences: number, words: number, syllables: number): number {
    return (0.39 * (words / sentences)) + (11.8 * (syllables / words)) - 15.59;
}

export function getFleschKincaidSentence(sentence: string): number {
    const words = getWordCount(sentence);
    const syllables = getSyllableCount(sentence);

    return Math.round(calculateFleschKincaid(1, words, syllables));
}

export function getFleschKincaidDoc(docContent: string): number {
    const sentences = getSentenceCount(docContent);
    const words = getWordCount(docContent);
    const syllables = getSyllableCount(docContent);

    return Math.round(calculateFleschKincaid(sentences, words, syllables));
}

// Calculate readability based on the Flesch-Kincaid Grade Level formula
function calculateSMOG(sentences: number, polysyllables: number): number {
    return 3.1291 + (1.0430 * Math.sqrt(polysyllables * (30 / sentences)));
}

export function getSMOGSentence(sentence: string): number {
    const polysyllables = getPolysyllabicWordCount(sentence);

    // SMOG needs at least 30 sentences to calculate its score properly...
    //  so we fake it here. I'm not sure if this is actually required.
    return calculateSMOG(30, polysyllables * 30);
}

export function getSMOGDoc(docContent: string): number {
    const sentences = getSentenceCount(docContent);
    const polysyllables = getPolysyllabicWordCount(docContent);

    return Math.round(calculateSMOG(sentences, polysyllables));
}

// Calculate readability based on the Spache Readability Formula
function calculateSpache(sentences: number, words: number, difficultWords: number): number {
    return 0.659 + (0.121 * (words / sentences)) + (0.082 * ((difficultWords / words) * 100));
}

export function getSpacheSentence(sentence: string): number {
    const words = getWordCount(sentence);
    const difficultWords = getDifficultWordCount(sentence, 'spache');

    return calculateSpache(1, words, difficultWords);
}

export function getSpacheDoc(docContent: string): number {
    const sentences = getSentenceCount(docContent);
    const words = getWordCount(docContent);
    const difficultWords = getDifficultWordCount(docContent, 'spache');

    return Math.round(calculateSpache(1, words, difficultWords));
}

// helper functions
function getWordCount(docContent: string): number {
    let wordCount = 0;
    wordCount = (docContent.match(/\w+/g) || []).length;

    return wordCount;
}

function getCharacterCount(docContent: string): number {
    // Strip all whitespace characters
    docContent = docContent.replace(/\s+/g, '');

    let charCount = 0;
    charCount = docContent.length;

    return charCount;
}

function getSentenceCount(docContent: string): number {
    // Approximate sentence count by finding word, followed by punctuation (.?!) and whitespace or end of string
    // as well as any words that match : or just a linebreak at the end of an unpunctuated line (eg: lists)
    // TODO: account for Markdown tables?
    let sentenceCount = 0;
    // need to do `|| []` to account for words matching that case not existing
    sentenceCount = (docContent.match(/\w[.?!](\s|$)/g) || []).length + (docContent.match(/\w:?\n/g) || []).length;

    // Return the count if more than zero sentences found, otherwise return 1
    return (sentenceCount > 0 ? sentenceCount : 1);
}

function getSyllableCount(docContent: string): number {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const syllable = require('syllable');
    let syllableCount = 0;

    syllableCount = syllable(docContent);

    return syllableCount;
}

function getDifficultWordCount(docContent: string, vocabulary: string): number {
    let familiarWords;
    switch (vocabulary) {
        case 'dale-chall':
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            familiarWords = require('dale-chall');
            break;
        case 'spache':
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            familiarWords = require('spache');
            break;
        default:
            return 0;
    }

    let difficultWordCount = 0;
    let wordList = [];

    // Grab words from document
    wordList = docContent.match(/\w+/g) || [];

    for (let i = 0; i < wordList.length; i++) {
        const word = wordList[i];
        difficultWordCount += (familiarWords.indexOf(word) > -1) ? 1 : 0;
    }

    return difficultWordCount;
}

function getPolysyllabicWordCount(docContent: string): number {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const syllable = require('syllable');
    let polysyllabicWordCount = 0;
    let wordList = [];

    // Grab words from document
    wordList = docContent.match(/\w+/g) || [];

    for (let i = 0; i < wordList.length; i++) {
        const word = wordList[i];
        polysyllabicWordCount += (syllable(word) >= 3 ) ? 1 : 0;
    }
    // console.log('Polysyllabic words: ' + polysyllabicWordCount);

    return polysyllabicWordCount;
}
