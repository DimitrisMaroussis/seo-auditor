import type { Lang } from "../i18n";
import type { VitalId } from "../types";

/*
 * Plain-language explanation of each metric: what visitors feel, why it
 * matters, and the most common fixes. Shown on the metric cards.
 */
export interface MetricInfo {
  name: string;       // everyday name, e.g. "Loading speed"
  what: string;       // what the visitor experiences
  affects: string;    // why it matters for the business
  fixes: string[];    // most common fixes, most effective first
}

export const METRIC_INFO: Record<Lang, Record<VitalId, MetricInfo>> = {
  en: {
    lcp: {
      name: "Loading speed",
      what: "How long until the biggest thing on the screen, usually the main headline or image, appears.",
      affects: "Slow loading makes people leave before they see your offer. Google also uses it for ranking.",
      fixes: [
        "Make the main image smaller (WebP or AVIF, at the size it's shown) and load it first.",
        "Stop CSS and scripts from blocking the page while it loads.",
        "Speed up the server with caching and a CDN.",
        "Never lazy-load the main image at the top of the page."
      ]
    },
    inp: {
      name: "Responsiveness",
      what: "How quickly the page visibly reacts when someone taps, clicks or types.",
      affects: "When a tap seems to do nothing, the page feels broken. People tap twice or give up on forms and quote requests.",
      fixes: [
        "Remove or delay third-party scripts you don't need (tags, chat, testing tools).",
        "Split long JavaScript work into smaller pieces.",
        "Do less work when buttons and form fields are used.",
        "Keep the page lighter: shorter menus, less hidden content."
      ]
    },
    cls: {
      name: "Visual stability",
      what: "How much the content jumps around unexpectedly while someone is using the page.",
      affects: "Jumping content makes people lose their place or tap the wrong thing, such as the wrong insurance plan.",
      fixes: [
        "Give every image and video a fixed width and height.",
        "Reserve space in advance for banners, cookie bars, ads and embeds.",
        "Don't insert content above what the visitor is already reading.",
        "Load fonts so the text doesn't change size when they arrive (font-display)."
      ]
    },
    fcp: {
      name: "First content",
      what: "How long until anything at all appears on the screen.",
      affects: "A blank screen makes people think the site is down.",
      fixes: ["Reduce files that block the page from appearing.", "Speed up the server response."]
    },
    ttfb: {
      name: "Server response",
      what: "How long the server takes to start sending the page.",
      affects: "Everything else waits for this, so a slow server slows every other number.",
      fixes: ["Use server caching and a CDN.", "Avoid redirects before the page."]
    }
  },
  el: {
    lcp: {
      name: "Ταχύτητα φόρτωσης",
      what: "Πόσο αργεί να εμφανιστεί το μεγαλύτερο στοιχείο της οθόνης, συνήθως ο κύριος τίτλος ή η κύρια εικόνα.",
      affects: "Η αργή φόρτωση κάνει τον κόσμο να φεύγει πριν δει την προσφορά σου. Η Google τη χρησιμοποιεί και για την κατάταξη.",
      fixes: [
        "Κάνε την κύρια εικόνα μικρότερη (WebP ή AVIF, στο μέγεθος που εμφανίζεται) και φόρτωσέ την πρώτη.",
        "Μην αφήνεις CSS και scripts να καθυστερούν την εμφάνιση της σελίδας.",
        "Επιτάχυνε τον server με caching και CDN.",
        "Μη φορτώνεις ποτέ με lazy loading την κύρια εικόνα στην κορυφή της σελίδας."
      ]
    },
    inp: {
      name: "Απόκριση",
      what: "Πόσο γρήγορα αντιδρά ορατά η σελίδα όταν κάποιος πατά, κάνει κλικ ή πληκτρολογεί.",
      affects: "Όταν ένα πάτημα φαίνεται να μην κάνει τίποτα, η σελίδα μοιάζει χαλασμένη. Ο κόσμος πατά ξανά ή εγκαταλείπει φόρμες και αιτήματα προσφοράς.",
      fixes: [
        "Αφαίρεσε ή καθυστέρησε scripts τρίτων που δεν χρειάζεσαι (tags, chat, εργαλεία δοκιμών).",
        "Χώρισε τις μεγάλες εργασίες JavaScript σε μικρότερα κομμάτια.",
        "Κάνε λιγότερη δουλειά όταν χρησιμοποιούνται κουμπιά και πεδία φόρμας.",
        "Κράτα τη σελίδα πιο ελαφριά: μικρότερα μενού, λιγότερο κρυφό περιεχόμενο."
      ]
    },
    cls: {
      name: "Οπτική σταθερότητα",
      what: "Πόσο «πηδάει» απρόσμενα το περιεχόμενο ενώ κάποιος χρησιμοποιεί τη σελίδα.",
      affects: "Το περιεχόμενο που μετακινείται κάνει τον κόσμο να χάνει τη θέση του ή να πατά λάθος, π.χ. σε λάθος πρόγραμμα ασφάλισης.",
      fixes: [
        "Δώσε σε κάθε εικόνα και βίντεο σταθερό πλάτος και ύψος.",
        "Κράτα από πριν χώρο για banners, μπάρα cookies, διαφημίσεις και embeds.",
        "Μην προσθέτεις περιεχόμενο πάνω από αυτό που ήδη διαβάζει ο επισκέπτης.",
        "Φόρτωνε τις γραμματοσειρές ώστε το κείμενο να μην αλλάζει μέγεθος (font-display)."
      ]
    },
    fcp: {
      name: "Πρώτο περιεχόμενο",
      what: "Πόσο αργεί να εμφανιστεί οτιδήποτε στην οθόνη.",
      affects: "Μια λευκή οθόνη κάνει τον κόσμο να νομίζει ότι το site δεν λειτουργεί.",
      fixes: ["Μείωσε τα αρχεία που καθυστερούν την εμφάνιση της σελίδας.", "Επιτάχυνε την απόκριση του server."]
    },
    ttfb: {
      name: "Απόκριση server",
      what: "Πόσο αργεί ο server να αρχίσει να στέλνει τη σελίδα.",
      affects: "Όλα τα άλλα περιμένουν αυτό, άρα ένας αργός server καθυστερεί κάθε άλλη μέτρηση.",
      fixes: ["Χρησιμοποίησε caching στον server και CDN.", "Απόφυγε ανακατευθύνσεις πριν τη σελίδα."]
    }
  }
};
