"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isPassed = isPassed;
exports.getFailedEvals = getFailedEvals;
exports.isAllPassed = isAllPassed;
exports.getPassRate = getPassRate;
function isPassed(result) {
    if (!result.success)
        return false;
    return result.evaluations.every(e => e.verdict.toLowerCase() !== 'yes');
}
function getFailedEvals(result) {
    return result.evaluations.filter(e => e.verdict.toLowerCase() === 'yes');
}
function isAllPassed(batch) {
    return batch.results.length > 0 && batch.results.every(r => isPassed(r));
}
function getPassRate(batch) {
    if (batch.results.length === 0)
        return 0;
    return batch.results.filter(r => isPassed(r)).length / batch.results.length;
}
//# sourceMappingURL=types.js.map