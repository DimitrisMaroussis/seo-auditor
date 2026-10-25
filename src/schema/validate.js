"use strict";

const { ruleFor, NO_GOOGLE_FEATURE, hasValue } = require("./rules");

const RICH_RESULTS_TEST = "https://search.google.com/test/rich-results";
const SCHEMA_VALIDATOR = "https://validator.schema.org/";

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

function typesOf(node) {
    const type = node["@type"];
    if (!type) return [];
    return (Array.isArray(type) ? type : [type]).filter(t => typeof t === "string");
}

/** Strip a schema.org prefix: "https://schema.org/Product" → "Product". */
function shortType(type) {
    return type.replace(/^https?:\/\/schema\.org\//i, "").replace(/^schema:/i, "");
}

function referencesSchemaOrg(context) {
    if (typeof context === "string") return /^https?:\/\/schema\.org\/?$/i.test(context.trim());
    if (Array.isArray(context)) return context.some(referencesSchemaOrg);
    if (isObject(context)) {
        if (typeof context["@vocab"] === "string" && /schema\.org/i.test(context["@vocab"])) return true;
        return Object.values(context).some(v => typeof v === "string" && /^https?:\/\/schema\.org\/?$/i.test(v));
    }
    return false;
}

/**
 * Walk a JSON-LD value and return every typed node.
 * `nested` is true when the node is a property value of another typed node
 * (as opposed to a top-level item or an @graph member).
 */
function findEntities(value, path = "$", entities = [], nested = false) {
    if (Array.isArray(value)) {
        value.forEach((item, i) => findEntities(item, `${path}[${i}]`, entities, nested));
        return entities;
    }
    if (!isObject(value)) return entities;

    const types = typesOf(value).map(shortType);
    if (types.length) entities.push({ path, types, data: value, nested });

    for (const [key, child] of Object.entries(value)) {
        if (key === "@type" || key === "@context") continue;
        const childNested = key === "@graph" ? false : (types.length > 0 || nested);
        findEntities(child, `${path}.${key}`, entities, childNested);
    }
    return entities;
}

/** Merge all nodes that share an @id so references are checked with full data. */
function mergeById(entities) {
    const byId = new Map();
    for (const entity of entities) {
        const id = entity.data["@id"];
        if (typeof id !== "string") continue;
        byId.set(id, { ...(byId.get(id) || {}), ...entity.data });
    }
    return byId;
}

function checkRule(entity, data, ruleType, rule) {
    const errors = [];
    const warnings = [];
    const skip = entity.nested ? new Set(rule.nestedOptional || []) : new Set();

    for (const prop of rule.required || []) {
        if (skip.has(prop)) continue;
        if (!hasValue(data[prop])) errors.push(`Missing required property "${prop}"`);
    }
    for (const group of rule.requiredAnyOf || []) {
        if (!group.some(prop => hasValue(data[prop]))) {
            errors.push(`Missing required property: one of ${group.map(p => `"${p}"`).join(", ")}`);
        }
    }
    for (const prop of rule.recommended || []) {
        if (!hasValue(data[prop])) warnings.push(`Missing recommended property "${prop}"`);
    }
    if (typeof rule.check === "function") {
        for (const { level, issue } of rule.check(data, { ruleType, nested: entity.nested })) {
            (level === "error" ? errors : warnings).push(issue);
        }
    }
    return { errors, warnings };
}

/**
 * Validate the raw contents of every <script type="application/ld+json"> block.
 *
 * Layers (each answers a different question):
 *   jsonSyntax   – does the block parse as JSON?
 *   schemaOrg    – is it plausible Schema.org JSON-LD (@context, @type present)?
 *                  Type/property names are NOT checked against the vocabulary.
 *   google       – for types Google documents, are the documented required
 *                  properties present? "requiredPropertiesPresent" is the best
 *                  this tool can say; it is not an eligibility verdict.
 */
function validateStructuredData(rawBlocks) {
    const result = {
        exists: rawBlocks.length > 0,
        blockCount: rawBlocks.length,
        types: [],
        blocks: [],
        jsonSyntax: { valid: 0, invalid: 0, errors: [] },
        schemaOrg: { errors: [], warnings: [] },
        google: { features: [], typesWithoutGoogleFeature: [], typesWithoutRule: [] },
        externalValidation: [
            `Confirm Google rich-result eligibility with the Rich Results Test: ${RICH_RESULTS_TEST}`,
            `Confirm Schema.org type and property names with the Schema Markup Validator: ${SCHEMA_VALIDATOR}`
        ]
    };

    const allEntities = [];

    rawBlocks.forEach((raw, i) => {
        const index = i + 1;
        const text = (raw || "").trim();

        if (!text) {
            result.jsonSyntax.invalid++;
            result.jsonSyntax.errors.push({ block: index, error: "Empty JSON-LD script" });
            result.blocks.push({ index, validJson: false, error: "Empty JSON-LD script" });
            return;
        }

        let parsed;
        try {
            parsed = JSON.parse(text);
        } catch (err) {
            result.jsonSyntax.invalid++;
            result.jsonSyntax.errors.push({ block: index, error: err.message });
            result.blocks.push({ index, validJson: false, error: err.message });
            return;
        }
        result.jsonSyntax.valid++;

        // ---- Schema.org layer ----
        const topItems = Array.isArray(parsed) ? parsed : [parsed];
        topItems.forEach((item, j) => {
            const where = Array.isArray(parsed) ? `block ${index} item ${j}` : `block ${index}`;
            if (!isObject(item)) {
                result.schemaOrg.errors.push({ block: index, issue: `${where} is not a JSON object` });
                return;
            }
            if (!("@context" in item)) {
                result.schemaOrg.errors.push({ block: index, issue: `${where} has no @context` });
            } else if (!referencesSchemaOrg(item["@context"])) {
                result.schemaOrg.warnings.push({ block: index, issue: `${where} @context does not reference schema.org` });
            }
            if (!item["@type"] && !Array.isArray(item["@graph"])) {
                result.schemaOrg.errors.push({ block: index, issue: `${where} has neither @type nor @graph` });
            }
        });

        const entities = findEntities(parsed, `block${index}`);
        entities.forEach(e => { e.block = index; });
        allEntities.push(...entities);

        result.blocks.push({
            index,
            validJson: true,
            types: [...new Set(entities.flatMap(e => e.types))],
            data: parsed
        });
    });

    // ---- Google layer ----
    const merged = mergeById(allEntities);
    const checkedIds = new Set();

    for (const entity of allEntities) {
        for (const type of entity.types) {
            if (!result.types.includes(type)) result.types.push(type);
        }

        const id = entity.data["@id"];
        if (typeof id === "string") {
            if (checkedIds.has(id)) continue;   // same node referenced again
            checkedIds.add(id);
        }
        const data = typeof id === "string" ? merged.get(id) : entity.data;

        const matchedRules = new Map();
        for (const type of entity.types) {
            const match = ruleFor(type);
            if (match) {
                if (!matchedRules.has(match.ruleType)) matchedRules.set(match.ruleType, { ...match, type });
            } else if (NO_GOOGLE_FEATURE.has(type)) {
                if (!result.google.typesWithoutGoogleFeature.includes(type)) {
                    result.google.typesWithoutGoogleFeature.push(type);
                }
            } else if (!result.google.typesWithoutRule.includes(type)) {
                result.google.typesWithoutRule.push(type);
            }
        }

        for (const { type, ruleType, rule } of matchedRules.values()) {
            const { errors, warnings } = checkRule(entity, data, ruleType, rule);
            let verdict;
            if (rule.status === "deprecated") verdict = "deprecated";
            else if (rule.status === "restricted") verdict = "restricted";
            else verdict = errors.length ? "missingRequiredProperties" : "requiredPropertiesPresent";

            result.google.features.push({
                block: entity.block,
                path: entity.path,
                type,
                rule: ruleType,
                feature: rule.feature,
                verdict,
                statusNote: rule.statusNote || null,
                errors,
                warnings
            });
        }
    }

    return result;
}

module.exports = { validateStructuredData, findEntities, referencesSchemaOrg };
