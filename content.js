function scrapeComments() {
    // Add a visual indicator that scanning is in progress
    const showScanningIndicator = () => {
        const existingIndicator = document.getElementById('judol-scan-indicator');
        if (existingIndicator) return;
        
        const indicator = document.createElement('div');
        indicator.id = 'judol-scan-indicator';
        indicator.style.cssText = `
            position: fixed;
            top: 10px;
            right: 10px;
            background: rgba(53, 99, 233, 0.9);
            color: white;
            padding: 10px 15px;
            border-radius: 4px;
            z-index: 9999;
            font-family: 'Roboto', sans-serif;
            font-size: 14px;
            box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
        `;
        indicator.textContent = 'Scanning comments...';
        document.body.appendChild(indicator);
        
        setTimeout(() => {
            if (indicator && indicator.parentNode) {
                indicator.parentNode.removeChild(indicator);
            }
        }, 5000);
    };
    
    showScanningIndicator();
    console.log("Content script: Starting to scan comments");
    
    // Ensure comments are loaded
    const ensureCommentsLoaded = () => {
        // Scroll to load more comments if available
        const commentSection = document.querySelector('#comments');
        if (commentSection) {
            commentSection.scrollIntoView({ behavior: 'smooth' });
        }
    };
    
    ensureCommentsLoaded();
    
    // Wait a bit longer to ensure comments are loaded
    setTimeout(() => {
        const threads = Array.from(document.querySelectorAll("ytd-comment-thread-renderer"));
        console.log(`Content script: Found ${threads.length} comments`);

        const data = threads.map(thread => {
            try {
                const textEl = thread.querySelector("#content-text");
                const anchor = thread.querySelector("a[href*='lc=']");
                const authorEl = thread.querySelector("#author-text");
                const timestampEl = thread.querySelector("#header-author yt-formatted-string.published-time-text");

                const text = textEl?.innerText?.trim() || '';
                const author = authorEl?.innerText?.trim() || 'Unknown Author';
                const timestamp = timestampEl?.innerText?.trim() || '';
                
                let id = null;
                let commentUrl = '';

                if (anchor) {
                    const url = new URL(anchor.href);
                    id = url.searchParams.get("lc");
                    commentUrl = anchor.href;
                }

                // Store additional metadata about the DOM element to help with deletion
                const menuButton = thread.querySelector('#action-menu button');
                const hasMenuButton = !!menuButton;

                return { 
                    id, 
                    text, 
                    author,
                    timestamp,
                    commentUrl,
                    hasMenuButton,
                    // Store a unique selector that can help find this comment again
                    domInfo: {
                        index: threads.indexOf(thread),
                        hasActionMenu: hasMenuButton
                    }
                };
            } catch (error) {
                console.error("Error processing comment:", error);
                return { id: null, text: '', error: error.message };
            }
        }).filter(comment => comment.id && comment.text);

        console.log(`Content script: Sending ${data.length} comments to background`);
        
        // Send message to background script
        try {
            chrome.runtime.sendMessage({ 
                action: 'foundComments', 
                comments: data,
                totalCommentsScanned: threads.length
            }, response => {
                if (chrome.runtime.lastError) {
                    console.error("Error sending comments to background:", chrome.runtime.lastError);
                } else {
                    console.log("Successfully sent comments to background:", response);
                }
            });
        } catch (error) {
            console.error("Exception sending comments to background:", error);
        }
    }, 2000); // Increased timeout to ensure comments are loaded
}

// Listen for messages from the extension
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    console.log("Content script received message:", msg);
    
    if (msg.action === 'scrapeComments') {
        console.log("Content script: Received scrapeComments message");
        scrapeComments();
        sendResponse({status: "Started scanning comments"});
        return true;
    }
    
    if (msg.action === 'spamProcessed') {
        console.log(`Content script: ${msg.count} spam comments processed`);
        sendResponse({received: true});
        return true;
    }
});

// Initialize when the page is fully loaded
if (document.readyState === 'complete') {
    console.log('Judol Spam Remover: Content script initialized');
} else {
    window.addEventListener('load', () => {
        console.log('Judol Spam Remover: Content script initialized on load');
    });
}
