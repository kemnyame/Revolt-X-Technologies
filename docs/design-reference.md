# Company website design direction

Reference supplied by the owner: https://aws.amazon.com/isv/ (reviewed 26 October 2026).

The reference page's published content was accessible through web retrieval. Its live browser view returned “Site Unavailable”, so its exact colours, rendered layout and animation timing could not be verified. No claim is made that the implementation reproduces those unobserved details.

The accessible content informed the progression: an opening company message, reasons to work together, three goal-based journeys, product detail, examples and common questions. The implementation uses Revolt-X copy, original company imagery and its custom Adriana identity. It does not use AWS branding, customer claims or AWS photographs.

## Interaction and motion

- The global header and the homepage section navigation stay available while reading.
- Page section links and a thin reading-progress line follow scroll position without changing browser history.
- Three journey tabs support clicks, Left/Right/Up/Down, Home and End. Panels have accessible names and selected state.
- Business examples use manual Previous/Next buttons and native horizontal scrolling. They never advance automatically.
- The opening line graphic draws once over 1.7 seconds. Photography enters over one second. Journey panel transitions take 280 ms. Other hover and navigation changes take 200–300 ms.
- Entrance motion never hides readable page content. Reduced-motion preferences disable movement and smooth scrolling.
- Translucent elements have opaque fallbacks. Body copy and key controls use high contrast colours.

The contact API, enquiry administration and Neon schema are unchanged by this design update.
