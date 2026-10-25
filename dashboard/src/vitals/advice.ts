import type { Lang } from "../i18n";

/*
 * Plain-language advice for Lighthouse 13 findings, keyed by audit id.
 * Findings without an entry fall back to Lighthouse's own English title and
 * description, so new Lighthouse checks still show up.
 */
interface Advice { title: string; fix: string }

export const ADVICE: Record<string, Record<Lang, Advice>> = {
  "render-blocking-insight": {
    en: { title: "Files that block the page from appearing", fix: "These CSS and JavaScript files must download before anything shows on screen. Load scripts with defer or async, inline the small amount of CSS needed for the top of the page, and load the rest later." },
    el: { title: "Αρχεία που καθυστερούν την εμφάνιση της σελίδας", fix: "Αυτά τα αρχεία CSS και JavaScript πρέπει να κατέβουν πριν εμφανιστεί οτιδήποτε. Φόρτωσε τα scripts με defer ή async, βάλε inline το λίγο CSS που χρειάζεται το πάνω μέρος της σελίδας και φόρτωσε το υπόλοιπο αργότερα." }
  },
  "unused-javascript": {
    en: { title: "JavaScript that is downloaded but not used", fix: "Large parts of these scripts are not needed on this page. Remove tags and plugins you don't use, and load page-specific code only on the pages that need it." },
    el: { title: "JavaScript που κατεβαίνει αλλά δεν χρησιμοποιείται", fix: "Μεγάλο μέρος αυτών των scripts δεν χρειάζεται σε αυτή τη σελίδα. Αφαίρεσε tags και plugins που δεν χρησιμοποιείς και φόρτωνε κώδικα μόνο στις σελίδες που τον χρειάζονται." }
  },
  "unused-css-rules": {
    en: { title: "CSS that is downloaded but not used", fix: "Most of these style rules don't apply to this page. Split large stylesheets or remove styles left over from old designs and plugins." },
    el: { title: "CSS που κατεβαίνει αλλά δεν χρησιμοποιείται", fix: "Οι περισσότεροι κανόνες αυτών των αρχείων δεν εφαρμόζονται σε αυτή τη σελίδα. Χώρισε τα μεγάλα αρχεία CSS ή αφαίρεσε στυλ που έμειναν από παλιά σχέδια και plugins." }
  },
  "cache-insight": {
    en: { title: "Files that browsers re-download too often", fix: "These files are cached for a short time, so returning visitors download them again. Ask the web team to set long cache lifetimes for static files (images, CSS, JS)." },
    el: { title: "Αρχεία που οι browsers κατεβάζουν ξανά πολύ συχνά", fix: "Αυτά τα αρχεία αποθηκεύονται για λίγο, οπότε οι επισκέπτες που επιστρέφουν τα κατεβάζουν ξανά. Ζήτησε από την ομάδα του site μεγάλη διάρκεια cache για στατικά αρχεία (εικόνες, CSS, JS)." }
  },
  "image-delivery-insight": {
    en: { title: "Images larger than they need to be", fix: "Serve images at the size they are displayed and in modern formats (WebP or AVIF). Most image plugins and CDNs can do this automatically." },
    el: { title: "Εικόνες μεγαλύτερες απ' όσο χρειάζεται", fix: "Δώσε τις εικόνες στο μέγεθος που εμφανίζονται και σε σύγχρονες μορφές (WebP ή AVIF). Τα περισσότερα plugins εικόνων και CDN το κάνουν αυτόματα." }
  },
  "lcp-breakdown-insight": {
    en: { title: "The main content appears late", fix: "See the LCP breakdown above for where the time goes: a slow server, a late start downloading the main image, a slow download, or a delay before it is drawn." },
    el: { title: "Το κύριο περιεχόμενο εμφανίζεται αργά", fix: "Δες την ανάλυση LCP παραπάνω για το πού πάει ο χρόνος: αργός server, αργή έναρξη λήψης της κύριας εικόνας, αργή λήψη ή καθυστέρηση πριν σχεδιαστεί." }
  },
  "lcp-discovery-insight": {
    en: { title: "The main image is found too late", fix: "Make the main image discoverable in the HTML: don't lazy-load it, and add fetchpriority=\"high\" or a preload link for it." },
    el: { title: "Η κύρια εικόνα εντοπίζεται πολύ αργά", fix: "Κάνε την κύρια εικόνα ορατή στο HTML: μην τη φορτώνεις με lazy loading και πρόσθεσε fetchpriority=\"high\" ή preload για αυτήν." }
  },
  "document-latency-insight": {
    en: { title: "The server responds slowly", fix: "The page's HTML takes long to arrive. Check server caching, redirects before the page, and text compression." },
    el: { title: "Ο server απαντά αργά", fix: "Το HTML της σελίδας αργεί να φτάσει. Έλεγξε το caching του server, ανακατευθύνσεις πριν τη σελίδα και τη συμπίεση κειμένου." }
  },
  "network-dependency-tree-insight": {
    en: { title: "Files that wait for other files", fix: "Some important files only start downloading after others finish. Preload or preconnect to the most important ones so they start earlier." },
    el: { title: "Αρχεία που περιμένουν άλλα αρχεία", fix: "Κάποια σημαντικά αρχεία ξεκινούν να κατεβαίνουν μόνο αφού τελειώσουν άλλα. Χρησιμοποίησε preload ή preconnect για τα πιο σημαντικά, ώστε να ξεκινούν νωρίτερα." }
  },
  "legacy-javascript-insight": {
    en: { title: "Old-style JavaScript for outdated browsers", fix: "These files include extra code for very old browsers. Building for modern browsers makes them smaller and faster." },
    el: { title: "Παλιού τύπου JavaScript για παλιούς browsers", fix: "Αυτά τα αρχεία περιέχουν επιπλέον κώδικα για πολύ παλιούς browsers. Αν φτιάχνονται για σύγχρονους browsers, γίνονται μικρότερα και γρηγορότερα." }
  },
  "duplicated-javascript-insight": {
    en: { title: "The same JavaScript is loaded twice", fix: "Some libraries are included more than once. Remove the duplicates." },
    el: { title: "Η ίδια JavaScript φορτώνεται δύο φορές", fix: "Κάποιες βιβλιοθήκες περιλαμβάνονται περισσότερες από μία φορές. Αφαίρεσε τα διπλά." }
  },
  "font-display-insight": {
    en: { title: "Text stays invisible while fonts load", fix: "Add font-display: swap to the site's fonts so text shows immediately in a fallback font." },
    el: { title: "Το κείμενο μένει αόρατο μέχρι να φορτώσουν οι γραμματοσειρές", fix: "Πρόσθεσε font-display: swap στις γραμματοσειρές, ώστε το κείμενο να εμφανίζεται αμέσως με εναλλακτική γραμματοσειρά." }
  },
  "cls-culprits-insight": {
    en: { title: "Elements that make the page jump", fix: "These elements move other content as the page loads. Reserve their space in advance (width and height for images, a fixed height for banners, ads and embeds)." },
    el: { title: "Στοιχεία που κάνουν τη σελίδα να «πηδάει»", fix: "Αυτά τα στοιχεία μετακινούν άλλο περιεχόμενο καθώς φορτώνει η σελίδα. Κράτα τον χώρο τους από πριν (πλάτος και ύψος στις εικόνες, σταθερό ύψος σε banners, διαφημίσεις και embeds)." }
  },
  "unsized-images": {
    en: { title: "Images without width and height", fix: "Add width and height attributes to these images so the browser reserves their space and the page doesn't jump when they load." },
    el: { title: "Εικόνες χωρίς πλάτος και ύψος", fix: "Πρόσθεσε width και height σε αυτές τις εικόνες, ώστε ο browser να κρατά τον χώρο τους και η σελίδα να μην «πηδάει» όταν φορτώνουν." }
  },
  "non-composited-animations": {
    en: { title: "Animations that can make the page jump", fix: "Animate with transform and opacity instead of size or position properties." },
    el: { title: "Animations που μπορεί να μετακινούν τη σελίδα", fix: "Κάνε τα animations με transform και opacity αντί για ιδιότητες μεγέθους ή θέσης." }
  },
  "bootup-time": {
    en: { title: "JavaScript that takes long to run", fix: "These scripts keep the browser busy, so taps and clicks respond late. Remove or delay non-essential scripts, especially third-party tags." },
    el: { title: "JavaScript που αργεί να εκτελεστεί", fix: "Αυτά τα scripts απασχολούν τον browser, οπότε τα πατήματα και τα κλικ αργούν να ανταποκριθούν. Αφαίρεσε ή καθυστέρησε τα μη απαραίτητα scripts, ειδικά τα tags τρίτων." }
  },
  "mainthread-work-breakdown": {
    en: { title: "The browser is busy for too long", fix: "Most of this time is spent running scripts. Reducing JavaScript is the most effective fix." },
    el: { title: "Ο browser είναι απασχολημένος για πολύ ώρα", fix: "Ο περισσότερος χρόνος πηγαίνει στην εκτέλεση scripts. Η μείωση της JavaScript είναι η πιο αποτελεσματική λύση." }
  },
  "long-tasks": {
    en: { title: "Long tasks that freeze the page", fix: "During these tasks the page can't respond to taps. Split long scripts into smaller pieces and delay third-party tags until after the page loads." },
    el: { title: "Μεγάλες εργασίες που «παγώνουν» τη σελίδα", fix: "Κατά τη διάρκεια αυτών των εργασιών η σελίδα δεν ανταποκρίνεται. Χώρισε τα μεγάλα scripts σε μικρότερα κομμάτια και καθυστέρησε τα tags τρίτων μέχρι να φορτώσει η σελίδα." }
  },
  "forced-reflow-insight": {
    en: { title: "Scripts that force extra layout work", fix: "These scripts read the page layout right after changing it, forcing the browser to recalculate. The web team can batch those reads and writes." },
    el: { title: "Scripts που προκαλούν επιπλέον υπολογισμούς διάταξης", fix: "Αυτά τα scripts διαβάζουν τη διάταξη της σελίδας αμέσως αφού την αλλάξουν, αναγκάζοντας τον browser να την ξαναϋπολογίσει. Η ομάδα του site μπορεί να ομαδοποιήσει αυτές τις ενέργειες." }
  },
  "dom-size-insight": {
    en: { title: "The page has too many elements", fix: "A very large page structure makes every interaction slower. Simplify long menus and hidden content." },
    el: { title: "Η σελίδα έχει πάρα πολλά στοιχεία", fix: "Μια πολύ μεγάλη δομή σελίδας κάνει κάθε αλληλεπίδραση πιο αργή. Απλοποίησε μεγάλα μενού και κρυφό περιεχόμενο." }
  },
  "third-parties-insight": {
    en: { title: "Third-party code", fix: "Scripts from other companies (analytics, ads, chat) run on your page. Review which are still needed; this ties in with the Tag Manager audit." },
    el: { title: "Κώδικας τρίτων", fix: "Scripts άλλων εταιρειών (analytics, διαφημίσεις, chat) τρέχουν στη σελίδα σου. Έλεγξε ποια χρειάζονται ακόμη· συνδέεται με τον έλεγχο του Tag Manager." }
  },
  "total-byte-weight": {
    en: { title: "The page is heavy to download", fix: "The page downloads a lot of data. The largest files are listed; images and scripts are usually the easiest to reduce." },
    el: { title: "Η σελίδα είναι βαριά", fix: "Η σελίδα κατεβάζει πολλά δεδομένα. Φαίνονται τα μεγαλύτερα αρχεία· συνήθως οι εικόνες και τα scripts μειώνονται πιο εύκολα." }
  },
  "unminified-javascript": {
    en: { title: "JavaScript that isn't compressed", fix: "Minify these files to make them smaller." },
    el: { title: "JavaScript χωρίς συμπίεση", fix: "Κάνε minify αυτά τα αρχεία για να γίνουν μικρότερα." }
  },
  "unminified-css": {
    en: { title: "CSS that isn't compressed", fix: "Minify these files to make them smaller." },
    el: { title: "CSS χωρίς συμπίεση", fix: "Κάνε minify αυτά τα αρχεία για να γίνουν μικρότερα." }
  },
  "viewport-insight": {
    en: { title: "Page isn't optimized for phones", fix: "Add a proper viewport meta tag so taps respond without delay on mobile." },
    el: { title: "Η σελίδα δεν είναι ρυθμισμένη για κινητά", fix: "Πρόσθεσε σωστό viewport meta tag, ώστε τα πατήματα να ανταποκρίνονται χωρίς καθυστέρηση στα κινητά." }
  }
};
