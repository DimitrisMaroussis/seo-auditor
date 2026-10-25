"use strict";

/*
 * Google Search structured-data rules.
 *
 * Source: Google Search Central structured data feature guides
 * (https://developers.google.com/search/docs/appearance/structured-data/search-gallery).
 * This table only encodes the properties Google lists as REQUIRED or
 * RECOMMENDED for each feature. It is intentionally small and must be kept in
 * sync with Google's documentation by hand; Google changes these rules.
 *
 * Passing these checks means "has the documented required properties", NOT
 * "will get a rich result". Google also applies content policies, quality
 * signals and page-level checks this tool cannot see, so every result points
 * to the Rich Results Test for confirmation.
 *
 * Rule shape:
 *   feature:      Google feature name
 *   status:       "active" | "restricted" | "deprecated"
 *   statusNote:   why a non-active feature will not normally show
 *   required:     property names that must have a value
 *   requiredAnyOf:arrays where at least one property in each array must exist
 *   recommended:  property names Google recommends (reported as warnings)
 *   nestedOptional: required props that are not needed when the entity is
 *                 nested inside its parent (e.g. itemReviewed)
 *   check(entity, ctx): optional custom checks → [{ level, issue }]
 */

const hasValue = (value) => {
    if (value === null || value === undefined) return false;
    if (typeof value === "string") return value.trim() !== "";
    if (Array.isArray(value)) return value.some(hasValue);
    return true;
};

function checkBreadcrumbItems(entity) {
    const issues = [];
    const raw = entity.itemListElement;
    const items = Array.isArray(raw) ? raw : (raw ? [raw] : []);

    if (items.length === 0) return issues; // already reported as missing required

    items.forEach((item, i) => {
        const label = `itemListElement[${i}]`;
        if (!item || typeof item !== "object") {
            issues.push({ level: "error", issue: `${label} is not an object` });
            return;
        }
        if (!hasValue(item.position)) {
            issues.push({ level: "error", issue: `${label} missing required position` });
        }
        const itemName = item.name ?? (item.item && typeof item.item === "object" ? item.item.name : undefined);
        if (!hasValue(itemName)) {
            issues.push({ level: "error", issue: `${label} missing required name` });
        }
        // Google: item (URL) is required except for the last breadcrumb.
        const isLast = i === items.length - 1;
        if (!isLast && !hasValue(item.item)) {
            issues.push({ level: "error", issue: `${label} missing required item (URL)` });
        }
    });
    return issues;
}

function checkRatingRange(entity) {
    const issues = [];
    const value = Number(entity.ratingValue);
    const best = entity.bestRating === undefined ? 5 : Number(entity.bestRating);   // Google default
    const worst = entity.worstRating === undefined ? 1 : Number(entity.worstRating); // Google default
    if (hasValue(entity.ratingValue) && Number.isFinite(value) && Number.isFinite(best) && Number.isFinite(worst)) {
        if (value > best || value < worst) {
            issues.push({
                level: "error",
                issue: `ratingValue ${value} is outside the rating scale ${worst}-${best}` +
                    (entity.bestRating === undefined ? " (bestRating defaults to 5)" : "")
            });
        }
    }
    return issues;
}

const RULES = {
    Article: {
        feature: "Article",
        status: "active",
        required: [],
        recommended: ["headline", "image", "datePublished", "dateModified", "author"]
    },
    BreadcrumbList: {
        feature: "Breadcrumb",
        status: "active",
        required: ["itemListElement"],
        recommended: [],
        check: checkBreadcrumbItems
    },
    Product: {
        feature: "Product snippet",
        status: "active",
        required: ["name"],
        requiredAnyOf: [["offers", "review", "aggregateRating"]],
        recommended: ["image", "description", "brand", "sku"]
    },
    AggregateRating: {
        feature: "Review snippet (aggregate rating)",
        status: "active",
        required: ["ratingValue", "itemReviewed"],
        requiredAnyOf: [["ratingCount", "reviewCount"]],
        nestedOptional: ["itemReviewed"],
        recommended: [],
        check: checkRatingRange
    },
    Review: {
        feature: "Review snippet",
        status: "active",
        required: ["author", "reviewRating", "itemReviewed"],
        nestedOptional: ["itemReviewed"],
        recommended: ["datePublished"]
    },
    Organization: {
        feature: "Organization (logo / knowledge panel)",
        status: "active",
        required: [],
        recommended: ["name", "url", "logo"]
    },
    LocalBusiness: {
        feature: "Local business",
        status: "active",
        required: ["name", "address"],
        recommended: ["telephone", "url", "geo", "openingHoursSpecification"]
    },
    WebSite: {
        feature: "Site name",
        status: "active",
        required: ["name", "url"],
        recommended: ["alternateName"]
    },
    Event: {
        feature: "Event",
        status: "active",
        required: ["name", "startDate", "location"],
        recommended: ["description", "endDate", "image", "offers", "organizer"]
    },
    JobPosting: {
        feature: "Job posting",
        status: "active",
        required: ["title", "description", "datePosted", "hiringOrganization", "jobLocation"],
        recommended: ["validThrough", "employmentType", "baseSalary"]
    },
    Recipe: {
        feature: "Recipe",
        status: "active",
        required: ["name", "image"],
        recommended: ["author", "datePublished", "description", "recipeIngredient", "recipeInstructions"]
    },
    VideoObject: {
        feature: "Video",
        status: "active",
        required: ["name", "thumbnailUrl", "uploadDate"],
        recommended: ["description", "duration", "contentUrl", "embedUrl"]
    },
    FAQPage: {
        feature: "FAQ",
        status: "restricted",
        statusNote: "Since August 2023 Google shows FAQ rich results only for well-known, authoritative government and health websites.",
        required: ["mainEntity"],
        recommended: []
    },
    Question: {
        feature: "FAQ (question)",
        status: "restricted",
        statusNote: "Part of FAQ markup; see FAQPage.",
        required: ["name", "acceptedAnswer"],
        recommended: []
    },
    Answer: {
        feature: "FAQ (answer)",
        status: "restricted",
        statusNote: "Part of FAQ markup; see FAQPage.",
        required: ["text"],
        recommended: []
    },
    HowTo: {
        feature: "How-to",
        status: "deprecated",
        statusNote: "Google stopped showing How-to rich results in September 2023.",
        required: [],
        recommended: []
    }
};

/*
 * Schema.org subtypes mapped to the rule that covers them. Not exhaustive:
 * Schema.org defines many more LocalBusiness subtypes. Unknown subtypes are
 * reported as "no Google rule", never as errors.
 */
const SUBTYPES = {
    NewsArticle: "Article",
    BlogPosting: "Article",
    ProductGroup: "Product",
    Corporation: "Organization",
    NGO: "Organization",
    OnlineStore: "Organization",
    InsuranceAgency: "LocalBusiness",
    FinancialService: "LocalBusiness",
    AccountingService: "LocalBusiness",
    AutoRepair: "LocalBusiness",
    Dentist: "LocalBusiness",
    LegalService: "LocalBusiness",
    MedicalBusiness: "LocalBusiness",
    ProfessionalService: "LocalBusiness",
    RealEstateAgent: "LocalBusiness",
    Restaurant: "LocalBusiness",
    Store: "LocalBusiness",
    TravelAgency: "LocalBusiness"
};

// Types that are valid Schema.org but have no Google Search feature.
const NO_GOOGLE_FEATURE = new Set([
    "WebPage", "ItemList", "ListItem", "Thing", "ContactPoint", "PostalAddress",
    "GeoCoordinates", "ImageObject", "Offer", "Person", "Rating", "Place",
    "OpeningHoursSpecification", "SearchAction", "EntryPoint", "Brand",
    "SiteNavigationElement", "WPHeader", "WPFooter"
]);

function ruleFor(type) {
    if (RULES[type]) return { ruleType: type, rule: RULES[type] };
    const mapped = SUBTYPES[type];
    if (mapped) return { ruleType: mapped, rule: RULES[mapped] };
    return null;
}

module.exports = { RULES, SUBTYPES, NO_GOOGLE_FEATURE, ruleFor, hasValue };
