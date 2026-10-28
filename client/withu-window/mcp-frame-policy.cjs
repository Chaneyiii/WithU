// The MCP app is a fixed bundled srcdoc resource. It has no navigation or
// popup capability; its initial about:srcdoc navigation is the sole exception.
function allowMcpFrameNavigation(details) {
  // Frame names are writable by App scripts and cannot be an authority check.
  // Withu's embedded frames are resource views; none may navigate to a URL.
  return details.isMainFrame || details.url === 'about:srcdoc' || details.url.startsWith('withu-app://');
}
module.exports = {allowMcpFrameNavigation};
