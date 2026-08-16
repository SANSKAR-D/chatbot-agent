import { useState, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import html2pdf from 'html2pdf.js';

export default function BlogProgress({ blogState }) {
  const [isDropdownOpen, setIsDropdownOpen] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const markdownRef = useRef(null);

  const handleDownload = async () => {
    if (!blogState.finalMarkdown || !markdownRef.current) return;
    setIsExporting(true);
    try {
      const opt = {
        margin: [12, 12, 12, 12],
        filename: 'blog.pdf',
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, logging: false },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak: { mode: ['avoid-all', 'css', 'legacy'] },
      };
      await html2pdf().set(opt).from(markdownRef.current).save();
    } catch (error) {
      console.error('Error generating PDF:', error);
      alert('Failed to generate PDF.');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="blog-progress-container">
      {/* Generating status card */}
      {blogState.isGenerating && (
        <div className="blog-status-card" role="status" aria-live="polite">
          <div
            className="blog-status-header"
            onClick={() => setIsDropdownOpen((o) => !o)}
            aria-expanded={isDropdownOpen}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && setIsDropdownOpen((o) => !o)}
          >
            <div className="blog-status-title">
              <div className="blog-spinner" aria-hidden="true" />
              Generating Blog…
            </div>
            <svg
              className={`blog-chevron ${isDropdownOpen ? 'open' : ''}`}
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </div>

          {isDropdownOpen && (
            <div className="blog-status-body">
              {/* Progress bar */}
              <div className="blog-progress-bar-track" role="progressbar" aria-label="Blog generation progress">
                <div className="blog-progress-bar-fill" />
              </div>

              {/* Current node */}
              <div className="blog-node-row">
                <span className="blog-node-label">Step:</span>
                <span className="blog-node-value">{blogState.currentNode || 'Initializing…'}</span>
              </div>

              {/* Status message */}
              <div className="blog-message">
                {blogState.message || 'Starting generation pipeline…'}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Final result */}
      {blogState.finalMarkdown && (
        <div className="blog-result-container">
          <div className="blog-toolbar">
            <button
              className="download-btn"
              onClick={handleDownload}
              disabled={isExporting}
              aria-label={isExporting ? 'Generating PDF…' : 'Download blog as PDF'}
            >
              {isExporting ? (
                <>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ animation: 'spin 1s linear infinite' }} aria-hidden="true">
                    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                  </svg>
                  Generating PDF…
                </>
              ) : (
                <>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                  Download PDF
                </>
              )}
            </button>
          </div>

          <div
            ref={markdownRef}
            className="markdown-body"
            aria-label="Generated blog content"
          >
            <ReactMarkdown
              components={{
                img: ({ node, src, ...props }) => {
                  const imageSrc = src.startsWith('http')
                    ? src
                    : `http://127.0.0.1:8000/blogs/${src}`;
                  return (
                    <img
                      crossOrigin="anonymous"
                      style={{ maxWidth: '100%', height: 'auto', borderRadius: '8px', margin: '16px 0' }}
                      src={imageSrc}
                      {...props}
                    />
                  );
                },
                h1: ({ node, ...props }) => (
                  <h1 style={{ borderBottom: '2px solid #dee2e6', paddingBottom: '0.4em', marginTop: '28px', fontWeight: 700 }} {...props} />
                ),
                h2: ({ node, ...props }) => (
                  <h2 style={{ borderBottom: '1px solid #dee2e6', paddingBottom: '0.3em', marginTop: '24px', fontWeight: 600 }} {...props} />
                ),
                h3: ({ node, ...props }) => (
                  <h3 style={{ marginTop: '20px', fontWeight: 600 }} {...props} />
                ),
                p: ({ node, ...props }) => (
                  <p style={{ lineHeight: '1.75', marginBottom: '16px' }} {...props} />
                ),
                code({ inline, className, children, ...props }) {
                  return inline ? (
                    <code style={{ background: '#e9ecef', padding: '2px 6px', borderRadius: '4px', fontSize: '0.88em', color: '#495057' }} {...props}>
                      {children}
                    </code>
                  ) : (
                    <pre style={{ background: '#f1f3f5', padding: '16px', borderRadius: '8px', overflowX: 'auto', fontSize: '0.88em' }}>
                      <code {...props}>{children}</code>
                    </pre>
                  );
                },
              }}
            >
              {blogState.finalMarkdown}
            </ReactMarkdown>
          </div>
        </div>
      )}

      {/* Empty/idle state */}
      {!blogState.isGenerating && !blogState.finalMarkdown && (
        <div className="empty-state">
          <div className="empty-state-icon" aria-hidden="true">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
              <line x1="16" y1="13" x2="8" y2="13"/>
              <line x1="16" y1="17" x2="8" y2="17"/>
              <polyline points="10 9 9 9 8 9"/>
            </svg>
          </div>
          <div>
            <h2>Blog Generator</h2>
            <p>Enter a topic below and the AI will research and write a full, structured blog post for you.</p>
          </div>
          <div className="empty-state-suggestions">
            {['Deep Learning', 'Climate Change', 'Quantum Computing', 'Space Exploration'].map((s) => (
              <div key={s} className="suggestion-chip" role="listitem">{s}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
