// Mind map extraction shared by content.js (mind maps rendered in the page)
// and the background script, which injects this file into the sandboxed app
// iframe (*.scf.usercontent.goog) that newer mind maps render in.
// Expands every node, then returns a standalone SVG plus the tree as JSON.
(() => {
if (globalThis.__nlmeMindmap) return;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function extractMindmapSVG(mindmapViewer) {
  console.log('[NotebookLM Takeout] Starting mindmap SVG extraction...');

  // First, try clicking the "Expand all" button if it exists
  const expandAllButton = document.querySelector('button[mattooltip*="Expand all"], button.expand-collapse-all-button-bottom, button[aria-label*="Expand all"]');
  if (expandAllButton) {
    console.log('[NotebookLM Takeout] Found "Expand all" button, clicking...');
    expandAllButton.click();

    // Wait for expansion to complete by checking node count
    console.log('[NotebookLM Takeout] Waiting for nodes to expand...');
    let previousNodeCount = 0;
    let stableCount = 0;

    // Keep checking until node count stabilizes (expansion complete)
    for (let i = 0; i < 20; i++) {
      await sleep(300);
      const currentNodeCount = mindmapViewer.querySelectorAll('g.node[role="treeitem"]').length;

      if (currentNodeCount === previousNodeCount) {
        stableCount++;
        if (stableCount >= 3) {
          console.log('[NotebookLM Takeout] Node count stabilized at', currentNodeCount);
          break;
        }
      } else {
        stableCount = 0;
      }

      console.log('[NotebookLM Takeout] Node count:', currentNodeCount);
      previousNodeCount = currentNodeCount;
    }

    console.log('[NotebookLM Takeout] Finished expanding all via button');
  } else {
    console.log('[NotebookLM Takeout] No "Expand all" button found, will expand nodes individually...');
  }

  // Find all nodes
  const allNodes = mindmapViewer.querySelectorAll('g.node[role="treeitem"]');
  console.log('[NotebookLM Takeout] Total nodes found:', allNodes.length);

  // Find collapsed nodes (aria-expanded="false")
  let collapsedNodes = Array.from(allNodes).filter(node =>
    node.getAttribute('aria-expanded') === 'false'
  );

  console.log('[NotebookLM Takeout] Collapsed nodes after expand all:', collapsedNodes.length);

  // Expand all collapsed nodes
  for (const node of collapsedNodes) {
    console.log('[NotebookLM Takeout] Expanding node:', node.getAttribute('aria-label'));

    // Try multiple methods to expand
    // Method 1: Click the circle
    const expandCircle = node.querySelector('circle');
    if (expandCircle) {
      expandCircle.dispatchEvent(new MouseEvent('click', {
        view: window,
        bubbles: true,
        cancelable: true
      }));
    }

    // Method 2: Click the node itself as fallback
    node.dispatchEvent(new MouseEvent('click', {
      view: window,
      bubbles: true,
      cancelable: true
    }));

    await sleep(300); // Wait for expansion animation
  }

  // Do another pass to catch any nested collapsed nodes
  await sleep(300);
  const stillCollapsed = Array.from(mindmapViewer.querySelectorAll('g.node[role="treeitem"]')).filter(
    node => node.getAttribute('aria-expanded') === 'false'
  );

  console.log('[NotebookLM Takeout] Nodes still collapsed after first pass:', stillCollapsed.length);

  // Expand any remaining collapsed nodes
  for (const node of stillCollapsed) {
    console.log('[NotebookLM Takeout] Second pass - expanding:', node.getAttribute('aria-label'));
    const expandCircle = node.querySelector('circle');
    if (expandCircle) {
      expandCircle.dispatchEvent(new MouseEvent('click', {
        view: window,
        bubbles: true,
        cancelable: true
      }));
    }
    await sleep(300);
  }

  // Wait a bit more for all expansions to complete and DOM to settle
  await sleep(1500);

  // Force a reflow to ensure all text is rendered
  document.body.offsetHeight;

  // Get the SVG element
  const svg = mindmapViewer.querySelector('svg');
  if (!svg) {
    throw new Error('SVG not found in mindmap viewer');
  }

  // Log what we're about to extract
  const textElements = svg.querySelectorAll('text');
  console.log('[NotebookLM Takeout] Text elements found in SVG:', textElements.length);
  if (textElements.length > 0) {
    console.log('[NotebookLM Takeout] Sample text content:', textElements[0].textContent);
  }

  // Clone the SVG to modify it (deep clone to get all children including text)
  const svgClone = svg.cloneNode(true);

  // Verify text elements were cloned
  const clonedTextElements = svgClone.querySelectorAll('text');
  console.log('[NotebookLM Takeout] Text elements in cloned SVG:', clonedTextElements.length);

  // Ensure text elements have explicit styles (copy computed styles to inline)
  clonedTextElements.forEach((textEl, idx) => {
    const originalText = textElements[idx];
    if (originalText) {
      const computedStyle = window.getComputedStyle(originalText);

      // Copy critical text rendering properties
      const styleProps = [
        'font-family',
        'font-size',
        'fill',
        'text-anchor',
        'dominant-baseline'
      ];

      let styleString = styleProps
        .map(prop => `${prop}: ${computedStyle.getPropertyValue(prop)}`)
        .join('; ');

      // IMPORTANT: Force fill-opacity to 1 (NotebookLM uses 1e-06 which makes text invisible)
      styleString += '; fill-opacity: 1 !important; opacity: 1 !important';

      textEl.setAttribute('style', styleString);

      // Also remove any fill-opacity attributes
      textEl.removeAttribute('fill-opacity');
      textEl.removeAttribute('opacity');
    }
  });

  // Inline computed paint on shapes too: node/link colors come from the app's
  // stylesheet (CSS classes), which a standalone SVG file doesn't carry
  const shapeSelector = 'rect, circle, ellipse, path, line, polyline, polygon';
  const originalShapes = svg.querySelectorAll(shapeSelector);
  svgClone.querySelectorAll(shapeSelector).forEach((shapeEl, idx) => {
    const originalShape = originalShapes[idx];
    if (!originalShape) return;
    const computedStyle = window.getComputedStyle(originalShape);
    const paintProps = ['fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-dasharray', 'opacity'];
    const styleString = paintProps
      .map(prop => `${prop}: ${computedStyle.getPropertyValue(prop)}`)
      .join('; ');
    shapeEl.setAttribute('style', styleString);
  });

  // Get SVG dimensions using bounding box
  const bbox = svg.getBBox();
  const padding = 50;

  // Calculate viewBox to capture all content with padding
  const viewBoxX = Math.floor(bbox.x - padding);
  const viewBoxY = Math.floor(bbox.y - padding);
  const viewBoxWidth = Math.ceil(bbox.width + (padding * 2));
  const viewBoxHeight = Math.ceil(bbox.height + (padding * 2));

  // Set proper SVG attributes for standalone file
  svgClone.setAttribute('width', viewBoxWidth);
  svgClone.setAttribute('height', viewBoxHeight);
  svgClone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  svgClone.setAttribute('viewBox', `${viewBoxX} ${viewBoxY} ${viewBoxWidth} ${viewBoxHeight}`);

  // Add embedded styles for text rendering
  const styleElement = document.createElementNS('http://www.w3.org/2000/svg', 'style');
  // No web font: the file is opened offline (and in the viewer's frame), so
  // it never loads anything; Google Sans is used where it is installed
  styleElement.textContent = `
    text {
      font-family: 'Google Sans', 'Roboto', Arial, sans-serif;
      dominant-baseline: middle;
      pointer-events: none;
    }

    .node-name {
      font-size: 20px;
      fill: #000;
      text-anchor: start;
    }

    .expand-symbol {
      font-size: 20px;
      fill: #000;
      text-anchor: middle;
      dominant-baseline: middle;
    }

    g.node rect {
      cursor: pointer;
    }

    g.node circle {
      cursor: pointer;
    }

    path.link {
      fill: none;
      stroke-width: 2px;
    }
  `;

  // Insert style as first child
  svgClone.insertBefore(styleElement, svgClone.firstChild);

  // Get the SVG as string
  const svgString = new XMLSerializer().serializeToString(svgClone);

  // Extract tree structure as JSON
  const treeData = extractMindmapTreeData(svg);

  console.log('[NotebookLM Takeout] SVG extracted successfully');
  console.log('[NotebookLM Takeout] Tree data:', treeData);

  return {
    isMindmap: true,
    svgContent: svgString,
    treeData: treeData,
    html: '', // No HTML for mindmaps
    sources: []
  };
}

// Rebuild parent/child links from nodes in DOM order, which is breadth-first:
// each node's parent is the first earlier node that still has room for
// children (its childCount, from the aria-label). Fills `children` in place.
// When levels or counts do not add up it leaves the tree flat under the first
// node rather than writing a wrong one, and returns { ok: false }.
function rebuildMindmapTree(list) {
  list.forEach(node => { node.children.length = 0; });
  if (list.length === 0) return { ok: false };
  let ok = list[0].level === 1;
  const queue = [list[0]];
  let at = 0;
  for (let i = 1; ok && i < list.length; i++) {
    const node = list[i];
    while (at < queue.length && queue[at].children.length >= queue[at].childCount) at++;
    const parent = queue[at];
    if (!parent || parent.level !== node.level - 1) { ok = false; break; }
    parent.children.push(node);
    queue.push(node);
  }
  // Too few children rendered (a collapsed node, a changed page)
  if (ok && list.some(node => node.children.length !== node.childCount)) ok = false;
  if (!ok) {
    list.forEach(node => { node.children.length = 0; });
    list[0].children.push(...list.slice(1));
  }
  return { ok };
}

// Extract mindmap tree structure as JSON
function extractMindmapTreeData(svg) {
  const nodes = svg.querySelectorAll('g.node[role="treeitem"]');
  const nodeMap = new Map();
  const tree = {
    title: '',
    nodes: [],
    metadata: {
      totalNodes: nodes.length,
      exportedAt: new Date().toISOString()
    }
  };

  // First pass: collect all nodes
  nodes.forEach(node => {
    const ariaLabel = node.getAttribute('aria-label') || '';
    const level = parseInt(node.getAttribute('aria-level')) || 0;
    const expanded = node.getAttribute('aria-expanded') === 'true';

    // Parse aria-label which is like "Family History, 5 children"
    const labelParts = ariaLabel.split(',');
    const name = labelParts[0]?.trim() || 'Unnamed';
    const childrenMatch = ariaLabel.match(/(\d+)\s+children?/);
    const childCount = childrenMatch ? parseInt(childrenMatch[1]) : 0;

    const nodeData = {
      name: name,
      level: level,
      expanded: expanded,
      children: [],
      childCount: childCount
    };

    nodeMap.set(node, nodeData);

    // Level 1 is the root
    if (level === 1) {
      tree.title = name;
      tree.root = nodeData;
    }
  });

  // The page lists nodes breadth-first (level by level, grouped by parent)
  const list = Array.from(nodes).map(node => nodeMap.get(node));
  if (list.length > 0 && !rebuildMindmapTree(list).ok) tree.metadata.structureUnreadable = true;

  // Flatten structure for nodes array
  tree.nodes = Array.from(nodeMap.values());

  return tree;
}

globalThis.__nlmeMindmap = { extractMindmapSVG, extractMindmapTreeData, rebuildMindmapTree };
})();
