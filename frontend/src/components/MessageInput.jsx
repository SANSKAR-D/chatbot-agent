import { useEffect, useRef } from 'react';

export default function MessageInput({
  inputValue,
  setInputValue,
  isStreaming,
  isUploading,
  onSubmit,
  onFileUpload,
  fileInputRef,
  appMode,
  hasExistingBlog
}) {
  const textareaRef = useRef(null);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [inputValue]);

  // Submit on Enter (Shift+Enter for newline)
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (inputValue.trim() && !isStreaming) {
        onSubmit(e);
      }
    }
  };

  const placeholder = appMode === 'chat'
    ? 'Ask anything… (Shift+Enter for new line)'
    : hasExistingBlog
      ? 'Provide feedback to refine the blog…'
      : 'Enter a blog topic, e.g. "Deep Learning"';

  return (
    <div className="input-container">
      <div className="input-wrapper">
        {/* Hidden file input */}
        <input
          type="file"
          accept="application/pdf"
          ref={fileInputRef}
          style={{ display: 'none' }}
          onChange={onFileUpload}
          aria-hidden="true"
        />

        <form className="input-box" onSubmit={onSubmit}>
          <textarea
            ref={textareaRef}
            rows={1}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={isStreaming}
            aria-label={placeholder}
            aria-multiline="true"
          />

          <div className="input-actions">
            {/* PDF attach button — chat mode only */}
            {appMode === 'chat' && (
              <button
                type="button"
                className="attach-btn"
                onClick={() => fileInputRef.current?.click()}
                disabled={isStreaming || isUploading}
                title="Attach PDF document"
                aria-label="Attach a PDF document"
              >
                {isUploading ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ animation: 'spin 1s linear infinite' }} aria-hidden="true">
                    <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
                  </svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
                  </svg>
                )}
              </button>
            )}

            {/* Send button */}
            <button
              type="submit"
              className="send-btn"
              disabled={!inputValue.trim() || isStreaming}
              title="Send message"
              aria-label="Send message"
            >
              {isStreaming ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="6" y="6" width="12" height="12" rx="2"/>
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
                </svg>
              )}
            </button>
          </div>
        </form>

        <p className="input-hint">
          {appMode === 'chat'
            ? 'AI can make mistakes. Verify important information.'
            : 'Blog generation uses AI — review before publishing.'}
        </p>
      </div>
    </div>
  );
}
