"use strict";

/*
 * robots.txt rules for one host, as Google reads them: the group for the most
 * specific matching user agent (else "*"), and for each URL the longest
 * matching Allow/Disallow path wins, Allow on a tie. "*" matches any run of
 * characters and a trailing "$" anchors the end.
 */

/**
 * @param {string} text  robots.txt body
 * @param {string} userAgent  the crawler's User-Agent header
 * @returns {{ allow: string[], disallow: string[] }} the rules that apply to this crawler
 */
function parseRobots(text, userAgent = "") {
    const groups = [];
    let current = null;
    let lastWasAgent = false;
    for (const rawLine of String(text || "").split(/\r?\n/)) {
        const line = rawLine.replace(/#.*$/, "").trim();
        const match = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
        if (!match) continue;
        const field = match[1].toLowerCase();
        const value = match[2].trim();
        if (field === "user-agent") {
            // Consecutive User-agent lines share one group.
            if (!lastWasAgent) groups.push(current = { agents: [], allow: [], disallow: [] });
            current.agents.push(value.toLowerCase());
            lastWasAgent = true;
            continue;
        }
        lastWasAgent = false;
        if (!current) continue;
        if (field === "allow" && value) current.allow.push(value);
        else if (field === "disallow" && value) current.disallow.push(value);
    }

    // The product token is the User-Agent up to the first "/" or space, e.g. "magentaseoauditor".
    const token = userAgent.toLowerCase().split(/[\s/]/)[0];
    const specific = groups.filter(g => g.agents.some(a => a !== "*" && token && token.startsWith(a)));
    const chosen = specific.length ? specific : groups.filter(g => g.agents.includes("*"));
    return {
        allow: chosen.flatMap(g => g.allow),
        disallow: chosen.flatMap(g => g.disallow)
    };
}

function patternToRegExp(pattern) {
    const anchored = pattern.endsWith("$");
    const body = (anchored ? pattern.slice(0, -1) : pattern)
        .split("*").map(part => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*");
    return new RegExp(`^${body}${anchored ? "$" : ""}`);
}

/** Whether the rules let this crawler fetch the URL. */
function isAllowed(rules, url) {
    if (!rules) return true;
    let path;
    try {
        const u = new URL(url);
        path = u.pathname + u.search;
    } catch {
        return true;
    }
    let best = { length: -1, allow: true };
    const consider = (pattern, allow) => {
        if (!patternToRegExp(pattern).test(path)) return;
        if (pattern.length > best.length || (pattern.length === best.length && allow)) best = { length: pattern.length, allow };
    };
    rules.disallow.forEach(p => consider(p, false));
    rules.allow.forEach(p => consider(p, true));
    return best.allow;
}

module.exports = { parseRobots, isAllowed };
