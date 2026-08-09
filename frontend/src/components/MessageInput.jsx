export default function MessageInput({
  inputValue,
  setInputValue,
  isStreaming,
  isUploading,
  onSubmit,
  onFileUpload,
  fileInputRef
}) {
  return (
    <div className="input-container">
      <form className="input-box" onSubmit={onSubmit}>
        <input
          type="file"
          accept="application/pdf"
          ref={fileInputRef}
          style={{ display: 'none' }}
          onChange={onFileUpload}
        />
        <button 
          type="button" 
          className="attach-btn" 
          onClick={() => fileInputRef.current?.click()}
          disabled={isStreaming || isUploading}
          title="Attach PDF"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path>
          </svg>
        </button>
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          placeholder="Ask anything"
          disabled={isStreaming}
        />
        <button type="submit" className="send-btn" disabled={!inputValue.trim() || isStreaming}>
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M2.01 21L23 12L2.01 3L2 10l15 2l-15 2z"
              fill="currentColor"
            />
          </svg>
        </button>
      </form>
    </div>
  );
}
