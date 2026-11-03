// NotebookLM Takeout - Sidebar: DOM health check (panel, report)
// Classic script, loads after sidebar-generated.js. Shared helpers live in sidebar-core.js.

// Store last health check results for report generation
let lastHealthCheckResults = null;
// ==================== DOM HEALTH CHECK ====================


/**
 * Run comprehensive DOM health check and display results
 */
async function runHealthCheck() {
  const panel = document.getElementById('health-check-panel');
  const loadingEl = document.getElementById('health-check-loading');
  const resultsEl = document.getElementById('health-check-results');

  // Show panel with loading state
  panel.style.display = 'block';
  loadingEl.style.display = 'flex';
  resultsEl.style.display = 'none';

  try {
    // Get current tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!isNotebookUrl(tab?.url)) {
      displayHealthCheckError('Please open NotebookLM first');
      return;
    }

    // Run the health check
    const results = await chrome.tabs.sendMessage(tab.id, {
      type: 'RUN_COMPREHENSIVE_HEALTH_CHECK',
      options: {}
    });

    // Store results for report generation
    lastHealthCheckResults = results;

    // Display results
    displayHealthCheckResults(results);
  } catch (error) {
    console.error('[NotebookLM Takeout] Health check error:', error);
    displayHealthCheckError(error.message || 'Failed to run health check');
  }
}

/**
 * Display health check error
 * @param {string} message - Error message
 */
function displayHealthCheckError(message) {
  const loadingEl = document.getElementById('health-check-loading');
  const resultsEl = document.getElementById('health-check-results');

  loadingEl.style.display = 'none';
  resultsEl.style.display = 'block';

  // Show error state
  const overallEl = document.getElementById('health-overall');
  overallEl.className = 'health-overall unhealthy';
  document.getElementById('health-overall-title').textContent = 'Health Check Failed';
  document.getElementById('health-overall-subtitle').textContent = message;

  // Clear categories
  document.getElementById('health-categories').innerHTML = '';
  document.getElementById('health-recommendations').style.display = 'none';
  document.getElementById('health-check-duration').textContent = '';
}

/**
 * Display health check results
 * @param {Object} results - Health check results from content script
 */
function displayHealthCheckResults(results) {
  const loadingEl = document.getElementById('health-check-loading');
  const resultsEl = document.getElementById('health-check-results');

  loadingEl.style.display = 'none';
  resultsEl.style.display = 'block';

  // Overall status
  const overallEl = document.getElementById('health-overall');
  overallEl.className = `health-overall ${results.overallHealthy ? 'healthy' : 'unhealthy'}`;

  document.getElementById('health-overall-title').textContent =
    results.overallHealthy ? 'All Systems Operational' : 'Issues Detected';
  document.getElementById('health-overall-subtitle').textContent =
    results.overallHealthy
      ? 'Extension is ready to export from this notebook.'
      : `${results.criticalFailures?.length || 0} critical issue(s) found.`;

  // Recommendations
  const recsEl = document.getElementById('health-recommendations');
  const recsListEl = document.getElementById('health-recommendations-list');
  if (results.recommendations && results.recommendations.length > 0) {
    recsListEl.innerHTML = results.recommendations.map(r => `<li>${escapeHtml(r)}</li>`).join('');
    recsEl.style.display = 'block';
  } else {
    recsEl.style.display = 'none';
  }

  // Categories
  const categoriesEl = document.getElementById('health-categories');
  categoriesEl.innerHTML = '';

  const categoryLabels = {
    general: 'General',
    notes: 'Notes',
    sources: 'Sources',
    artifacts: 'Artifacts',
    chat: 'Chat History',
    citations: 'Citations'
  };

  for (const [categoryKey, categoryData] of Object.entries(results.categories || {})) {
    const categoryEl = document.createElement('div');
    categoryEl.className = 'health-category';

    const headerEl = document.createElement('div');
    headerEl.className = 'health-category-header';
    headerEl.innerHTML = `
      <div class="health-category-title">
        <span class="health-category-status ${categoryData.healthy ? 'passed' : 'failed'}"></span>
        <span>${categoryLabels[categoryKey] || categoryKey}</span>
      </div>
      <svg class="health-category-toggle" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
        <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"/>
      </svg>
    `;

    headerEl.addEventListener('click', () => {
      categoryEl.classList.toggle('expanded');
    });

    const checksEl = document.createElement('div');
    checksEl.className = 'health-category-checks';

    if (categoryData.error) {
      checksEl.innerHTML = `
        <div class="health-check-item">
          <div class="health-check-icon failed"></div>
          <div class="health-check-details">
            <div class="health-check-name">Check failed</div>
            <div class="health-check-note">${escapeHtml(categoryData.error)}</div>
          </div>
        </div>
      `;
    } else if (categoryData.checks && categoryData.checks.length > 0) {
      checksEl.innerHTML = categoryData.checks.map(check => {
        // Non-critical failures show as 'info' (gray), critical failures show as 'failed' (red)
        let statusClass;
        if (check.passed) {
          statusClass = 'passed';
        } else if (check.name === 'Skipped') {
          statusClass = 'skipped';
        } else if (check.critical === false) {
          statusClass = 'info'; // Non-critical failure - informational only
        } else {
          statusClass = 'failed';
        }
        return `
          <div class="health-check-item">
            <div class="health-check-icon ${statusClass}"></div>
            <div class="health-check-details">
              <div class="health-check-name">${escapeHtml(check.name)}${check.count !== undefined ? ` (${check.count})` : ''}</div>
              ${check.note ? `<div class="health-check-note">${escapeHtml(check.note)}</div>` : ''}
              ${check.selector ? `<div class="health-check-selector">${escapeHtml(check.selector)}</div>` : ''}
            </div>
          </div>
        `;
      }).join('');
    } else {
      checksEl.innerHTML = `
        <div class="health-check-item">
          <div class="health-check-icon skipped"></div>
          <div class="health-check-details">
            <div class="health-check-name">No checks performed</div>
          </div>
        </div>
      `;
    }

    categoryEl.appendChild(headerEl);
    categoryEl.appendChild(checksEl);
    categoriesEl.appendChild(categoryEl);

    // Auto-expand failed categories
    if (!categoryData.healthy) {
      categoryEl.classList.add('expanded');
    }
  }

  // Duration
  document.getElementById('health-check-duration').textContent =
    results.duration ? `Completed in ${results.duration}ms` : '';
}

/**
 * Generate a text report from health check results
 * @param {Object} results - Health check results
 * @returns {string} - Formatted text report
 */
function generateHealthReport(results) {
  const lines = [];
  const timestamp = new Date().toISOString();

  lines.push('# NotebookLM Takeout - DOM Health Check Report');
  lines.push(`Generated: ${timestamp}`);
  lines.push('');

  // Overall status
  lines.push(`## Overall Status: ${results.overallHealthy ? 'HEALTHY' : 'ISSUES DETECTED'}`);
  lines.push('');

  // Critical failures
  if (results.criticalFailures && results.criticalFailures.length > 0) {
    lines.push('## Critical Failures');
    results.criticalFailures.forEach(f => lines.push(`- ${f}`));
    lines.push('');
  }

  // Recommendations
  if (results.recommendations && results.recommendations.length > 0) {
    lines.push('## Recommendations');
    results.recommendations.forEach(r => lines.push(`- ${r}`));
    lines.push('');
  }

  // Category details
  const categoryLabels = {
    general: 'General',
    notes: 'Notes',
    sources: 'Sources',
    artifacts: 'Artifacts',
    chat: 'Chat History',
    citations: 'Citations'
  };

  lines.push('## Category Details');
  lines.push('');

  for (const [categoryKey, categoryData] of Object.entries(results.categories || {})) {
    const label = categoryLabels[categoryKey] || categoryKey;
    const status = categoryData.healthy ? 'PASS' : 'FAIL';
    lines.push(`### ${label}: ${status}`);

    if (categoryData.error) {
      lines.push(`Error: ${categoryData.error}`);
    } else if (categoryData.checks && categoryData.checks.length > 0) {
      categoryData.checks.forEach(check => {
        // Non-critical failures show as [INFO], critical failures show as [FAIL]
        let icon;
        if (check.passed) {
          icon = '[OK]';
        } else if (check.warning) {
          icon = '[WARN]'; // Non-critical, but exports lose fidelity
        } else if (check.critical === false) {
          icon = '[INFO]'; // Non-critical - informational only
        } else {
          icon = '[FAIL]';
        }
        let line = `  ${icon} ${check.name}`;
        if (check.count !== undefined) line += ` (${check.count})`;
        lines.push(line);
        if (check.note) lines.push(`       ${check.note}`);
        if (check.selector && !check.passed) lines.push(`       Selector: ${check.selector}`);
      });
    }
    lines.push('');
  }

  // Metadata
  lines.push('## Metadata');
  lines.push(`Duration: ${results.duration}ms`);
  lines.push(`User Agent: ${navigator.userAgent}`);
  lines.push('');

  // Note about tooltip test
  lines.push('---');
  lines.push('Note: The Citations category reads two real citations exactly the way exports do.');
  lines.push('If it fails, note and chat exports would lose their quotes; please report it with this file.');
  lines.push('');

  return lines.join('\n');
}

/**
 * Copy health check report to clipboard
 */
async function copyHealthReport() {
  if (!lastHealthCheckResults) {
    showToast('No health check results to copy', 'error');
    return;
  }

  try {
    const report = generateHealthReport(lastHealthCheckResults);
    await navigator.clipboard.writeText(report);
    showToast('Report copied to clipboard', 'success');
  } catch (error) {
    console.error('[NotebookLM Takeout] Failed to copy report:', error);
    showToast('Failed to copy report', 'error');
  }
}
