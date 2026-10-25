"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { validateStructuredData } = require("../src/schema/validate");
const { RULES } = require("../src/schema/rules");

const block = (obj) => JSON.stringify({ "@context": "https://schema.org", ...obj });
const feature = (result, type) => result.google.features.find(f => f.type === type);

test("no JSON-LD → exists:false and no claims", () => {
    const r = validateStructuredData([]);
    assert.equal(r.exists, false);
    assert.deepEqual(r.google.features, []);
});

test("JSON syntax errors are separated from schema checks", () => {
    const r = validateStructuredData(['{"@type": "Product",}', "   ", block({ "@type": "WebPage" })]);
    assert.equal(r.jsonSyntax.valid, 1);
    assert.equal(r.jsonSyntax.invalid, 2);
    assert.equal(r.jsonSyntax.errors[1].error, "Empty JSON-LD script");
    assert.deepEqual(r.types, ["WebPage"]);
});

test("Schema.org layer: missing @context and missing @type", () => {
    const r = validateStructuredData([JSON.stringify({ "@type": "Thing" }), block({ name: "x" })]);
    assert.ok(r.schemaOrg.errors.some(e => /no @context/.test(e.issue)));
    assert.ok(r.schemaOrg.errors.some(e => /neither @type nor @graph/.test(e.issue)));
});

test("false positive guard: a Product type alone is NOT reported as passing", () => {
    const r = validateStructuredData([block({ "@type": "Product" })]);
    const f = feature(r, "Product");
    assert.equal(f.verdict, "missingRequiredProperties");
    assert.ok(f.errors.some(e => /"name"/.test(e)));
    assert.ok(f.errors.some(e => /one of "offers", "review", "aggregateRating"/.test(e)));
});

test("a complete Product passes required checks but the verdict is not 'eligible'", () => {
    const r = validateStructuredData([block({
        "@type": "Product", name: "Car cover",
        offers: { "@type": "Offer", price: "10", priceCurrency: "EUR" }
    })]);
    const f = feature(r, "Product");
    assert.equal(f.verdict, "requiredPropertiesPresent");
    assert.equal(f.errors.length, 0);
    assert.ok(r.externalValidation.some(s => /Rich Results Test/.test(s)));
    assert.ok(!JSON.stringify(r).includes('"eligible"'));
});

test("AggregateRating: bestRating is optional, ratingCount OR reviewCount is enough", () => {
    const r = validateStructuredData([block({
        "@type": "Product", name: "X",
        aggregateRating: { "@type": "AggregateRating", ratingValue: 4.5, reviewCount: 12 }
    })]);
    const f = feature(r, "AggregateRating");
    assert.equal(f.verdict, "requiredPropertiesPresent", JSON.stringify(f));
    assert.ok(!f.warnings.some(w => /bestRating/.test(w)));
    assert.ok(!f.errors.some(e => /itemReviewed/.test(e)), "itemReviewed is implied when nested");
});

test("AggregateRating: missing both counts is an error; top-level needs itemReviewed", () => {
    const r = validateStructuredData([block({ "@type": "AggregateRating", ratingValue: 4 })]);
    const f = feature(r, "AggregateRating");
    assert.ok(f.errors.some(e => /"ratingCount", "reviewCount"/.test(e)));
    assert.ok(f.errors.some(e => /"itemReviewed"/.test(e)));
});

test("AggregateRating: ratingValue outside default 1-5 scale", () => {
    const r = validateStructuredData([block({
        "@type": "Product", name: "X",
        aggregateRating: { "@type": "AggregateRating", ratingValue: 9, ratingCount: 3 }
    })]);
    assert.ok(feature(r, "AggregateRating").errors.some(e => /outside the rating scale 1-5/.test(e)));
    const ok = validateStructuredData([block({
        "@type": "Product", name: "X",
        aggregateRating: { "@type": "AggregateRating", ratingValue: 9, bestRating: 10, ratingCount: 3 }
    })]);
    assert.equal(feature(ok, "AggregateRating").errors.length, 0);
});

test("Organization: no required properties, so nothing is an error", () => {
    const r = validateStructuredData([block({ "@type": "Organization" })]);
    const f = feature(r, "Organization");
    assert.equal(f.errors.length, 0);
    assert.ok(f.warnings.some(w => /"logo"/.test(w)));
});

test("InsuranceAgency maps to LocalBusiness rules (address required)", () => {
    const r = validateStructuredData([block({ "@type": "InsuranceAgency", name: "Agency" })]);
    const f = feature(r, "InsuranceAgency");
    assert.equal(f.rule, "LocalBusiness");
    assert.equal(f.verdict, "missingRequiredProperties");
    assert.ok(f.errors.some(e => /"address"/.test(e)));
});

test("FAQPage is 'restricted', never presented as an active rich result", () => {
    const r = validateStructuredData([block({
        "@type": "FAQPage",
        mainEntity: [{ "@type": "Question", name: "Q?", acceptedAnswer: { "@type": "Answer", text: "A" } }]
    })]);
    for (const type of ["FAQPage", "Question", "Answer"]) {
        assert.equal(feature(r, type).verdict, "restricted", type);
    }
    assert.match(feature(r, "FAQPage").statusNote, /government and health/);
});

test("WebPage is valid Schema.org without a Google feature; unknown types get no rule", () => {
    const r = validateStructuredData([block({ "@type": ["WebPage", "MadeUpType"] })]);
    assert.deepEqual(r.google.typesWithoutGoogleFeature, ["WebPage"]);
    assert.deepEqual(r.google.typesWithoutRule, ["MadeUpType"]);
    assert.equal(r.google.features.length, 0);
});

test("BreadcrumbList: last item may omit 'item'; others may not", () => {
    const good = validateStructuredData([block({
        "@type": "BreadcrumbList",
        itemListElement: [
            { "@type": "ListItem", position: 1, name: "Home", item: "https://a.gr/" },
            { "@type": "ListItem", position: 2, name: "Car" }
        ]
    })]);
    assert.equal(feature(good, "BreadcrumbList").verdict, "requiredPropertiesPresent");

    const bad = validateStructuredData([block({
        "@type": "BreadcrumbList",
        itemListElement: [{ "@type": "ListItem", name: "Home" }, { "@type": "ListItem", position: 2, name: "Car" }]
    })]);
    const errors = feature(bad, "BreadcrumbList").errors;
    assert.ok(errors.some(e => /\[0\] missing required position/.test(e)));
    assert.ok(errors.some(e => /\[0\] missing required item/.test(e)));
});

test("@graph entities sharing an @id are merged before checking", () => {
    const r = validateStructuredData([block({
        "@graph": [
            { "@type": "InsuranceAgency", "@id": "#agency", name: "A", address: { "@type": "PostalAddress", streetAddress: "x" } },
            { "@type": "WebPage", "@id": "#page", publisher: { "@type": "InsuranceAgency", "@id": "#agency" } }
        ]
    })]);
    const agencies = r.google.features.filter(f => f.type === "InsuranceAgency");
    assert.equal(agencies.length, 1, "same @id checked once");
    assert.equal(agencies[0].verdict, "requiredPropertiesPresent");
});

test("multiple blocks and arrays of items are all processed", () => {
    const r = validateStructuredData([
        JSON.stringify([
            { "@context": "https://schema.org", "@type": "Organization", name: "O" },
            { "@context": "https://schema.org", "@type": "WebSite", name: "S", url: "https://a.gr/" }
        ]),
        block({ "@type": "BreadcrumbList", itemListElement: [] })
    ]);
    assert.equal(r.blockCount, 2);
    assert.deepEqual(r.types.sort(), ["BreadcrumbList", "Organization", "WebSite"]);
    assert.equal(feature(r, "WebSite").verdict, "requiredPropertiesPresent");
    assert.equal(feature(r, "BreadcrumbList").verdict, "missingRequiredProperties");
});

test("full schema.org type IRIs are understood", () => {
    const r = validateStructuredData([block({ "@type": "https://schema.org/Product", name: "X", offers: {} })]);
    assert.equal(feature(r, "Product").verdict, "requiredPropertiesPresent");
});

test("rules table is well-formed", () => {
    for (const [type, rule] of Object.entries(RULES)) {
        assert.ok(["active", "restricted", "deprecated"].includes(rule.status), type);
        assert.ok(Array.isArray(rule.required), type);
        assert.ok(Array.isArray(rule.recommended), type);
        if (rule.status !== "active") assert.ok(rule.statusNote, `${type} needs a statusNote`);
    }
});
