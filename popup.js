document.addEventListener('DOMContentLoaded', async () => {
    const scanBtn = document.getElementById('scan');
    const confirmDeleteBtn = document.getElementById('confirmDelete');
    const blockedInput = document.getElementById('blockedWords');
    const spamListDiv = document.getElementById('spamList');
    const scanStatus = document.getElementById('scanStatus');

    let spamComments = [];
    let selectedCommentIds = new Set();
    let isDeleting = false;
    let isScanning = false;

    console.log("Popup initialized");

    // Debug function to help diagnose issues
    function debugSpamList() {
        console.log("Debug Spam List:");
        console.log("- spamListDiv exists:", !!spamListDiv);
        if (spamListDiv) {
            console.log("- spamListDiv display:", window.getComputedStyle(spamListDiv).display);
            console.log("- spamListDiv visibility:", window.getComputedStyle(spamListDiv).visibility);
            console.log("- spamListDiv opacity:", window.getComputedStyle(spamListDiv).opacity);
            console.log("- spamListDiv height:", window.getComputedStyle(spamListDiv).height);
            console.log("- spamListDiv has children:", spamListDiv.children.length > 0);
            console.log("- spamListDiv classes:", spamListDiv.className);
            console.log("- spamListDiv parent display:", window.getComputedStyle(spamListDiv.parentElement).display);
        }
    }
    
    // Call debug function after a short delay
    setTimeout(debugSpamList, 500);

    // Load saved blocked words
    chrome.storage.local.get(['blockedWords', 'lastScanStats'], (data) => {
        blockedInput.value = data.blockedWords?.join(', ') || '';
        
        // Show last scan stats if available
        if (data.lastScanStats) {
            const { totalScanned, spamDetected, timestamp } = data.lastScanStats;
            if (timestamp) {
                const scanDate = new Date(timestamp);
                const formattedDate = scanDate.toLocaleString();
                scanStatus.textContent = `Last scan: ${spamDetected} spam / ${totalScanned} total (${formattedDate})`;
            }
        }
    });

    // Save blocked words when changed
    blockedInput.addEventListener('input', () => {
        const words = blockedInput.value.split(',').map(w => w.trim()).filter(Boolean);
        chrome.storage.local.set({ blockedWords: words });
    });

    // Show a loading animation during scanning
    function showScanningAnimation() {
        isScanning = true;
        scanBtn.disabled = true;
        scanBtn.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="spin-animation"><path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" stroke-dasharray="1, 2"></path></svg>
            <span>Scanning...</span>
        `;
        
        updateUIWithAnimation(scanStatus, 'Scanning comments... Please wait');
    }

    // Reset the UI after scanning
    function resetScanUI() {
        isScanning = false;
        scanBtn.disabled = false;
        scanBtn.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
            <span>Scan Comments</span>
        `;
    }

    // Update the UI with animated transitions
    function updateUIWithAnimation(element, newContent) {
        element.style.opacity = '0';
        setTimeout(() => {
            element.innerHTML = newContent;
            element.style.opacity = '1';
        }, 200);
    }

    // Scan for spam comments
    scanBtn.addEventListener('click', () => {
        if (isDeleting || isScanning) return;
        
        showScanningAnimation();
        spamListDiv.style.display = 'none';
        spamListDiv.classList.remove('visible');
        confirmDeleteBtn.style.display = 'none';
        confirmDeleteBtn.classList.remove('visible');
        
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (!tabs || !tabs[0] || !tabs[0].id) {
                alert("Cannot access current tab. Make sure you're on a YouTube video page.");
                resetScanUI();
                return;
            }
            
            chrome.scripting.executeScript({
                target: { tabId: tabs[0].id },
                function: () => {
                    // This function runs in the context of the web page
                    console.log("Directly executing scrapeComments from popup");
                    
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
                    
                    // Ensure comments are loaded
                    const commentSection = document.querySelector('#comments');
                    if (commentSection) {
                        commentSection.scrollIntoView({ behavior: 'smooth' });
                    }
                    
                    // Wait a bit longer to ensure comments are loaded
                    setTimeout(() => {
                        const threads = Array.from(document.querySelectorAll("ytd-comment-thread-renderer"));
                        console.log(`Found ${threads.length} comments`);

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

                                if (anchor) {
                                    const url = new URL(anchor.href);
                                    id = url.searchParams.get("lc");
                                }

                                return { 
                                    id, 
                                    text, 
                                    author,
                                    timestamp
                                };
                            } catch (error) {
                                console.error("Error processing comment:", error);
                                return { id: null, text: '', error: error.message };
                            }
                        }).filter(comment => comment.id && comment.text);

                        console.log(`Sending ${data.length} comments to background`);
                        chrome.runtime.sendMessage({ 
                            action: 'foundComments', 
                            comments: data,
                            totalCommentsScanned: threads.length
                        });
                    }, 2000);
                }
            }).catch(error => {
                console.error("Error executing script:", error);
                alert("Error scanning comments: " + error.message);
                resetScanUI();
            });
        });
    });

    // Listen for messages from content script and background
    chrome.runtime.onMessage.addListener((msg) => {
        console.log("Popup received message:", msg);
        
        if (msg.action === 'notify' && msg.message) {
            alert(msg.message);
        }

        if (msg.action === 'reloadTab') {
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                chrome.tabs.reload(tabs[0].id);
            });

            spamListDiv.innerHTML = '';
            spamListDiv.style.display = 'none';
            spamListDiv.classList.remove('visible');
            confirmDeleteBtn.style.display = 'none';
            confirmDeleteBtn.classList.remove('visible');
            scanStatus.textContent = 'Waiting to scan comments...';
            isDeleting = false;
        }

        if (msg.action === 'showSpam') {
            console.log("Received showSpam message with", msg.comments?.length || 0, "comments");
            resetScanUI();
            spamComments = msg.comments || [];
            displaySpamComments(spamComments, msg.stats);
        }
    });
    
    // Update delete button text based on selection
    function updateDeleteButton() {
        if (selectedCommentIds.size === 0) {
            confirmDeleteBtn.innerHTML = '<span>No Comments Selected</span>';
            confirmDeleteBtn.disabled = true;
        } else {
            confirmDeleteBtn.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                <span>Delete ${selectedCommentIds.size} Comments</span>
            `;
            confirmDeleteBtn.disabled = false;
        }
    }

    // Update the display of comments in the spam list
    function displaySpamComments(comments, stats) {
        console.log("Displaying", comments.length, "spam comments");
        spamListDiv.innerHTML = '';
        
        // Show stats
        const totalScanned = stats?.totalScanned || comments.length;
        scanStatus.textContent = `Found: ${comments.length} spam / ${totalScanned} total`;

        if (comments.length > 0) {
            // Make sure the spam list is visible
            spamListDiv.style.display = 'block';
            spamListDiv.classList.add('visible');
            confirmDeleteBtn.style.display = 'flex';
            confirmDeleteBtn.classList.add('visible');
            selectedCommentIds = new Set();

            // Add "Select All" checkbox
            const selectAllDiv = document.createElement('div');
            selectAllDiv.className = 'select-all-container';
            selectAllDiv.innerHTML = `
                <input type="checkbox" id="select-all" checked />
                <label for="select-all"><strong>Select/Deselect All</strong></label>
            `;
            spamListDiv.appendChild(selectAllDiv);
            
            // Add divider
            const divider = document.createElement('div');
            divider.className = 'divider';
            spamListDiv.appendChild(divider);

            // Add comments
            comments.forEach((comment, i) => {
                // Truncate comment text if too long
                const displayText = comment.text.length > 80 
                    ? comment.text.substring(0, 80) + '...' 
                    : comment.text;
                
                const div = document.createElement('div');
                div.className = 'comment-item';
                
                // Create the main comment content with enhanced display
                let commentHtml = `
                    <input type="checkbox" id="spam-${i}" checked />
                    <div class="comment-content">
                        <label for="spam-${i}" class="comment-text">${escapeHTML(displayText)}</label>
                `;
                
                // Add author if available
                if (comment.author) {
                    commentHtml += `<div class="comment-author">${escapeHTML(comment.author)}</div>`;
                }
                
                // Add timestamp if available
                if (comment.timestamp) {
                    commentHtml += `<div class="comment-timestamp">${escapeHTML(comment.timestamp)}</div>`;
                }
                
                // Add spam reasons if available with enhanced display
                if (comment.spamReasons && comment.spamReasons.length > 0) {
                    const mainReason = comment.spamReasons[0];
                    commentHtml += `<div class="spam-reason">${escapeHTML(mainReason)}</div>`;
                    
                    // If there are multiple reasons, add them as tooltips
                    if (comment.spamReasons.length > 1) {
                        const additionalReasons = comment.spamReasons.slice(1).join(', ');
                        commentHtml += `<div class="additional-reasons" title="${escapeHTML(additionalReasons)}">+${comment.spamReasons.length - 1} more</div>`;
                    }
                }
                
                commentHtml += `</div>`;
                div.innerHTML = commentHtml;
                
                spamListDiv.appendChild(div);
                selectedCommentIds.add(comment.id);
                
                // Add event listener to checkbox
                const checkbox = div.querySelector('input');
                checkbox.addEventListener('change', (e) => {
                    if (e.target.checked) {
                        selectedCommentIds.add(comment.id);
                    } else {
                        selectedCommentIds.delete(comment.id);
                    }
                    updateDeleteButton();
                });
            });
            
            // Add event listener to "Select All" checkbox
            const selectAllCheckbox = document.getElementById('select-all');
            if (selectAllCheckbox) {
                selectAllCheckbox.addEventListener('change', (e) => {
                    const checkboxes = spamListDiv.querySelectorAll('.comment-item input[type="checkbox"]');
                    checkboxes.forEach((checkbox, i) => {
                        checkbox.checked = e.target.checked;
                        if (e.target.checked) {
                            selectedCommentIds.add(comments[i].id);
                        } else {
                            selectedCommentIds.delete(comments[i].id);
                        }
                    });
                    updateDeleteButton();
                });
            }
            
            updateDeleteButton();
            
            // Force a reflow to ensure the list is displayed
            spamListDiv.style.opacity = '0.99';
            setTimeout(() => {
                spamListDiv.style.opacity = '1';
                
                // Check if the list is actually visible
                const isVisible = window.getComputedStyle(spamListDiv).display !== 'none';
                console.log("Spam list visibility check:", isVisible ? "visible" : "hidden");
                
                // Run debug function
                debugSpamList();
                
                // Ensure delete button is visible by scrolling to it
                const deleteButtonContainer = confirmDeleteBtn.parentElement;
                if (deleteButtonContainer) {
                    deleteButtonContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }
            }, 100);
        } else {
            scanStatus.textContent = 'No spam comments found';
            spamListDiv.style.display = 'none';
            spamListDiv.classList.remove('visible');
        }
    }

    // Helper function to escape HTML to prevent XSS
    function escapeHTML(str) {
        if (!str) return '';
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // Delete selected comments
    confirmDeleteBtn.addEventListener('click', () => {
        if (isDeleting) return;
        
        const toDelete = spamComments.filter(c => selectedCommentIds.has(c.id));
        if (toDelete.length === 0) {
            alert("No comments selected for deletion.");
            return;
        }

        // Confirm deletion
        if (!confirm(`Are you sure you want to delete ${toDelete.length} comments? This action cannot be undone.`)) {
            return;
        }
        
        isDeleting = true;
        
        // Show animated status
        updateUIWithAnimation(scanStatus, `<span class="deleting-status">Deleting ${toDelete.length} comments...</span>`);
        
        // Disable and show loading on delete button
        confirmDeleteBtn.disabled = true;
        confirmDeleteBtn.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="spin-animation"><path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" stroke-dasharray="1, 2"></path></svg>
            <span>Deleting...</span>
        `;
        
        // Add visual effect to selected comments
        toDelete.forEach(comment => {
            const index = spamComments.findIndex(c => c.id === comment.id);
            if (index !== -1) {
                const commentEl = spamListDiv.querySelectorAll('.comment-item')[index];
                if (commentEl) {
                    commentEl.classList.add('deleting');
                    commentEl.style.opacity = '0.5';
                }
            }
        });
        
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            chrome.scripting.executeScript({
                target: { tabId: tabs[0].id },
                func: deleteCommentsById,
                args: [toDelete.map(c => c.id)]
            }).catch(error => {
                console.error("Error executing delete script:", error);
                alert("Error deleting comments: " + error.message);
                isDeleting = false;
                resetScanUI();
            });
        });
    });
});

// Function to scrape comments from YouTube page
function scrapeComments() {
    console.log("Starting to scrape comments...");
    
    setTimeout(() => {
        const threads = Array.from(document.querySelectorAll("ytd-comment-thread-renderer"));
        console.log(`Found ${threads.length} comment threads`);

        const data = threads.map(thread => {
            const textEl = thread.querySelector("#content-text");
            const anchor = thread.querySelector("a[href*='lc=']");
            const authorEl = thread.querySelector("#author-text");
            const timestampEl = thread.querySelector("#header-author yt-formatted-string.published-time-text");

            const text = textEl?.innerText?.trim() || '';
            const author = authorEl?.innerText?.trim() || '';
            const timestamp = timestampEl?.innerText?.trim() || '';
            let id = null;

            if (anchor) {
                const url = new URL(anchor.href);
                id = url.searchParams.get("lc");
            }

            return { id, text, author, timestamp };
        }).filter(comment => comment.id && comment.text);

        console.log(`Filtered ${data.length} valid comments`);
        chrome.runtime.sendMessage({ 
            action: 'foundComments', 
            comments: data,
            totalCommentsScanned: threads.length
        });
    }, 1000);
}

// Function to delete comments by ID
function deleteCommentsById(commentIds) {
    async function deleteCommentById(commentId) {
        try {
            // Find the comment thread
            const thread = Array.from(document.querySelectorAll("ytd-comment-thread-renderer"))
                .find(t => {
                    const anchor = t.querySelector("a[href*='lc=']");
                    const id = anchor ? new URL(anchor.href).searchParams.get("lc") : null;
                    return id === commentId;
                });

            if (!thread) {
                console.warn(`Comment with ID ${commentId} not found`);
                return { success: false, error: 'Comment not found' };
            }

            // Find and click the menu button (three dots)
            const menuButton = thread.querySelector('#action-menu button');
            if (!menuButton) {
                console.warn(`Menu button not found for comment ${commentId}`);
                return { success: false, error: 'Menu button not found' };
            }
            
            menuButton.click();
            await new Promise(r => setTimeout(r, 500)); // Increased wait time

            // Find and click the remove option
            const menuItems = Array.from(document.querySelectorAll('tp-yt-paper-item'));
            const removeItem = menuItems.find(item => 
                item.innerText.toLowerCase().includes("remove") || 
                item.innerText.toLowerCase().includes("hapus")
            );
            
            if (!removeItem) {
                console.warn(`Remove option not found for comment ${commentId}`);
                // Close the menu by clicking elsewhere
                document.body.click();
                return { success: false, error: 'Remove option not found' };
            }
            
            removeItem.click();
            await new Promise(r => setTimeout(r, 800)); // Increased wait time for dialog

            // Find and click the confirm button
            const confirmBtns = Array.from(document.querySelectorAll('yt-confirm-dialog-renderer button'));
            const confirmBtn = confirmBtns.find(btn => 
                btn.innerText.toLowerCase().includes("remove") || 
                btn.innerText.toLowerCase().includes("hapus") ||
                btn.innerText.toLowerCase().includes("ok")
            );

            if (!confirmBtn) {
                console.warn(`Confirm button not found for comment ${commentId}`);
                return { success: false, error: 'Confirm button not found' };
            }
            
            // Click the confirm button
            confirmBtn.click();
            console.log(`Confirmed removal of comment ${commentId}`);
            
            // Wait for the comment to be removed
            await new Promise(r => setTimeout(r, 1000));
            
            // Verify the comment was actually removed
            const stillExists = Array.from(document.querySelectorAll("ytd-comment-thread-renderer"))
                .some(t => {
                    const anchor = t.querySelector("a[href*='lc=']");
                    const id = anchor ? new URL(anchor.href).searchParams.get("lc") : null;
                    return id === commentId;
                });
                
            if (stillExists) {
                console.warn(`Comment ${commentId} still exists after deletion attempt`);
                return { success: false, error: 'Comment still exists after deletion' };
            }
            
            return { success: true };
        } catch (error) {
            console.error(`Error deleting comment ${commentId}:`, error);
            return { success: false, error: error.message };
        }
    }

    (async () => {
        let successCount = 0;
        let failedComments = [];
        
        for (const id of commentIds) {
            const result = await deleteCommentById(id);
            if (result.success) {
                successCount++;
            } else {
                failedComments.push({ id, error: result.error });
            }
            // Add a longer delay between deletions to ensure YouTube processes each one
            await new Promise(r => setTimeout(r, 1200));
        }
        
        // Report results
        if (successCount === commentIds.length) {
            chrome.runtime.sendMessage({ 
                action: 'notify', 
                message: `Successfully deleted all ${successCount} comments!` 
            });
        } else if (successCount > 0) {
            chrome.runtime.sendMessage({ 
                action: 'notify', 
                message: `Deleted ${successCount} out of ${commentIds.length} comments. Some comments could not be deleted.` 
            });
            console.error('Failed comments:', failedComments);
        } else {
            chrome.runtime.sendMessage({ 
                action: 'notify', 
                message: 'Failed to delete comments. Please try again or check console for details.' 
            });
            console.error('All deletions failed:', failedComments);
        }
        
        // Only reload if at least one comment was deleted
        if (successCount > 0) {
            chrome.runtime.sendMessage({ action: 'reloadTab' });
        }
    })();
}

