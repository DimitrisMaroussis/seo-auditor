"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { parseRobots, isAllowed } = require("../src/robots");

const UA = "MagentaSEOAuditor/1.0 (+https://github.com/)";

test("robots: the * group applies, longest match wins, Allow wins a tie", () => {
    const rules = parseRobots(`
        User-agent: Googlebot
        Disallow: /

        User-agent: *
        Disallow: /wp-admin/
        Allow: /wp-admin/admin-ajax.php
        Disallow: /*?replytocom=
        Disallow: /*.pdf$
        Disallow: /private  # comment
        Allow: /private
    `, UA);
    const ok = (path) => isAllowed(rules, `https://ex.gr${path}`);
    assert.equal(ok("/car"), true);
    assert.equal(ok("/wp-admin/options.php"), false);
    assert.equal(ok("/wp-admin/admin-ajax.php"), true);
    assert.equal(ok("/post?replytocom=5"), false);
    assert.equal(ok("/files/terms.pdf"), false);
    assert.equal(ok("/files/terms.pdf?v=2"), true, "$ anchors the end");
    assert.equal(ok("/private"), true, "Allow wins a tie");
});

test("robots: a group naming the auditor replaces the * group; no robots.txt allows all", () => {
    const rules = parseRobots("User-agent: *\nDisallow: /\n\nUser-agent: MagentaSEOAuditor\nDisallow: /secret\n", UA);
    assert.equal(isAllowed(rules, "https://ex.gr/car"), true);
    assert.equal(isAllowed(rules, "https://ex.gr/secret/x"), false);
    assert.equal(isAllowed(null, "https://ex.gr/anything"), true);
    assert.equal(isAllowed(parseRobots("User-agent: *\nDisallow:\n", UA), "https://ex.gr/x"), true, "empty Disallow allows all");
});
