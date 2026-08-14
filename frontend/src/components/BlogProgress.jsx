import { useState, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import html2pdf from 'html2pdf.js';

export default function BlogProgress({ blogState }) {
  const [isDropdownOpen, setIsDropdownOpen] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const markdownRef = useRef(null);

  // blogState structure: { isGenerating: boolean, currentNode: string, message: string, finalMarkdown: string }

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
        pagebreak: { mode: ['avoid-all', 'css', 'legacy'] }
      };
      
      await html2pdf().set(opt).from(markdownRef.current).save();
    } catch (error) {
      console.error("Error generating PDF:", error);
      alert("Failed to generate PDF.");
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="blog-progress-container" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '20px', height: '100%', overflowY: 'auto' }}>
      
      {blogState.isGenerating && (
        <div className="blog-status-dropdown" style={{ borderRadius: '8px', backgroundColor: '#1e1f20', overflow: 'hidden', boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3)' }}>
          <div 
            className="dropdown-header" 
            style={{ padding: '14px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', backgroundColor: '#282a2c', color: '#e3e3e3' }}
            onClick={() => setIsDropdownOpen(!isDropdownOpen)}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div className="spinner" style={{ width: '16px', height: '16px', border: '2px solid #a855f7', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite' }}></div>
              <strong>Generating Blog...</strong>
            </div>
            <svg style={{ transform: isDropdownOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
          </div>
          
          {isDropdownOpen && (
            <div className="dropdown-content" style={{ padding: '16px', color: '#e3e3e3' }}>
              <div style={{ marginBottom: '8px', fontSize: '0.95rem' }}>
                <strong style={{ color: '#a855f7' }}>Current Node:</strong> {blogState.currentNode || 'Initializing...'}
              </div>
              <div style={{ color: '#c4c7c5', fontSize: '0.9rem' }}>
                {blogState.message || 'Starting process...'}
              </div>
            </div>
          )}
        </div>
      )}

      {blogState.finalMarkdown && (
        <div className="blog-result-container" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button 
              onClick={handleDownload}
              disabled={isExporting}
              style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 16px', backgroundColor: 'var(--accent-color, #007bff)', color: 'white', border: 'none', borderRadius: '4px', cursor: isExporting ? 'not-allowed' : 'pointer', opacity: isExporting ? 0.7 : 1 }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
              {isExporting ? 'Generating PDF...' : 'Download as PDF'}
            </button>
          </div>
          <div ref={markdownRef} className="markdown-body" style={{ padding: '32px', backgroundColor: '#e8e9ea', color: '#1a1a1a', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.1)' }}>
            <ReactMarkdown 
              components={{
                img: ({node, src, ...props}) => {
                  const imageSrc = src.startsWith('http') ? src : `http://127.0.0.1:8000/blogs/${src}`;
                  return <img crossOrigin="anonymous" style={{maxWidth: '100%', height: 'auto', borderRadius: '8px', margin: '16px 0'}} src={imageSrc} {...props} />;
                },
                h1: ({node, ...props}) => <h1 style={{borderBottom: '1px solid #c9cace', paddingBottom: '0.3em', marginTop: '24px'}} {...props} />,
                h2: ({node, ...props}) => <h2 style={{borderBottom: '1px solid #c9cace', paddingBottom: '0.3em', marginTop: '24px'}} {...props} />,
                h3: ({node, ...props}) => <h3 style={{marginTop: '24px'}} {...props} />,
                p: ({node, ...props}) => <p style={{lineHeight: '1.6', marginBottom: '16px'}} {...props} />
              }}
            >
              {blogState.finalMarkdown}
            </ReactMarkdown>
          </div>
        </div>
      )}
    </div>
  );
}
