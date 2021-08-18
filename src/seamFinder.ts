'use strict';

export class SeamLookup {
    constructor(
        public start: number,
        public length: number,
    ){}
}

// this uses the algorithm described over here:
// https://insights.untapt.com/mapping-between-processed-and-original-unstructured-text-data-36136b69c879
export class SeamFinder {
    private seams: [number, number][] = [];

    constructor(
        private original: string,
        private stripped: string,
    ) {
        let originalIndex = 0;
        let strippedIndex = 0;
        let seamStart = -1;

        while (originalIndex < original.length && strippedIndex < stripped.length) {
            if (original[originalIndex] === stripped[strippedIndex]) {
                if (seamStart !== -1) {
                    this.seams.push([strippedIndex, originalIndex - seamStart]);
                    seamStart = -1;
                }
                strippedIndex += 1;
            } else if (seamStart === -1) {
                seamStart = originalIndex
            }
            originalIndex += 1;
        }
    }

    lookup(startIndex: number, length: number): SeamLookup {
        const endIndex = startIndex + length;
        let seamIndex = 0;
        let startResult = 0;
        let endResult = 0;

        while (seamIndex < this.seams.length) {
            const currentSeam = this.seams[seamIndex];

            if (startIndex >= currentSeam[0]) {
                startResult += currentSeam[1];
            }
            if (endIndex > currentSeam[0]) {
                endResult += currentSeam[1];
            }

            seamIndex += 1
        }

        return new SeamLookup(startResult + startIndex, length + endResult - startResult);
    }
}
