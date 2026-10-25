"use strict";

/**
 * Map over items with at most `concurrency` workers in flight.
 * Results keep input order. A rejected worker becomes { error } in the result
 * so one failure never aborts the batch. When `signal` aborts, no new items
 * start; items never started are left undefined in the results.
 */
async function mapWithConcurrency(items, concurrency, worker, { signal } = {}) {
    const results = new Array(items.length);
    let next = 0;
    const limit = Math.max(1, Math.min(concurrency || 1, items.length || 1));

    async function run() {
        while (next < items.length && !signal?.aborted) {
            const index = next++;
            try {
                results[index] = await worker(items[index], index);
            } catch (error) {
                results[index] = { error: { code: "EWORKER", message: error.message } };
            }
        }
    }

    await Promise.all(Array.from({ length: limit }, run));
    return results;
}

module.exports = { mapWithConcurrency };
