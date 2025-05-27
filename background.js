let spamList = [];
let lastScanStats = {
    totalScanned: 0,
    spamDetected: 0,
    timestamp: null
};

// Helper function to check if text contains emojis
function countEmojis(text) {
    const emojiRegex = /[\u{1F300}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu;
    const matches = text.match(emojiRegex);
    return matches ? matches.length : 0;
}

// Helper function to check for repeated characters
function hasRepeatedCharacters(text, minRepeat = 5) {
    const regex = new RegExp(`(.)\\1{${minRepeat - 1},}`, 'g');
    return regex.test(text);
}

// Helper function to check for unusual character distribution
function hasUnusualCharacterDistribution(text) {
    if (!text || text.length < 10) return false;
    
    // Check for high percentage of special characters
    const specialChars = text.match(/[^\w\s]/g) || [];
    const specialCharRatio = specialChars.length / text.length;
    
    // Check for unusual capitalization
    const uppercaseChars = text.match(/[A-Z]/g) || [];
    const uppercaseRatio = uppercaseChars.length / text.length;
    
    return specialCharRatio > 0.3 || uppercaseRatio > 0.5;
}

// Helper function to detect unusual fonts and formatting
function hasUnusualFormatting(text) {
    if (!text || text.length < 5) return false;
    
    // Check for unicode character ranges often used for "fancy" text
    const fancyUnicode = /[\u{1D400}-\u{1D7FF}\u{1F700}-\u{1F77F}\u{2700}-\u{27BF}\u{2600}-\u{26FF}\u{1F900}-\u{1F9FF}\u{2300}-\u{23FF}\u{2460}-\u{24FF}\u{25A0}-\u{25FF}\u{2100}-\u{214F}\u{2190}-\u{21FF}\u{2000}-\u{206F}\u{2700}-\u{27BF}\u{1F680}-\u{1F6FF}\u{1F100}-\u{1F1FF}]/gu;
    
    // Check for unusual symbols often used in spam
    const unusualSymbols = /[★☆✰✦✧✩✪✫✬✭✮✯✱✲✳✴✵✶✷✸✹✺✻✼❄❅❆❇❈❉❊❋]/g;
    
    // Check for text that looks like ASCII art or unusual spacing
    const asciiArtPatterns = /(\|{2,}|\/{3,}|\\{3,}|\*{3,}|\-{3,}|_{3,}|={3,}|\+{3,})/;
    
    // Check for excessive use of brackets, often used to create "bold" looking text
    const excessiveBrackets = /(\({2,}|\){2,}|\[{2,}|\]{2,}|\{{2,}|\}{2,})/;
    
    // Check for zalgo text (characters with many combining marks)
    const zalgoPattern = /[\u0300-\u036F\u1AB0-\u1AFF\u1DC0-\u1DFF\u20D0-\u20FF\uFE20-\uFE2F]{2,}/;
    
    return fancyUnicode.test(text) || 
           unusualSymbols.test(text) || 
           asciiArtPatterns.test(text) || 
           excessiveBrackets.test(text) ||
           zalgoPattern.test(text);
}

// Function to send message to all extension views
function sendMessageToExtensionViews(message) {
    chrome.runtime.sendMessage(message).catch(error => {
        // Ignore errors about receiving end not existing
        if (!error.message.includes("receiving end does not exist")) {
            console.error("Error sending message:", error);
        }
    });
}

// Listen for messages from content scripts and popup
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    console.log("Background script received message:", msg.action);
    
    if (msg.action === 'foundComments') {
        console.log(`Processing ${msg.comments.length} comments`);
        
        chrome.storage.local.get(['blockedWords'], ({ blockedWords }) => {
            // Make sure blockedWords is an array
            const blockedWordsArray = Array.isArray(blockedWords) ? blockedWords : [];
            const hasCustomKeywords = blockedWordsArray.length > 0;
            
            // Store scan statistics
            lastScanStats = {
                totalScanned: msg.totalCommentsScanned || msg.comments.length,
                timestamp: new Date().toISOString()
            };
            
            // Indonesian gambling keywords
            const indonesianGamblingKeywords = [
                'judi', 'judol', 'togel', 'slot', 'casino', 'poker', 'bandar', 'betting', 'taruhan',
                'bola', 'sbobet', 'maxbet', 'parlay', 'toto', 'bet88', 'bet365', 'maxwin', 'bonus',
                'deposit', 'withdraw', 'rtp', 'gacor', 'jackpot', 'scatter', 'wild', 'pragmatic', 'pg soft',
                'habanero', 'microgaming', 'joker', 'spadegaming', 'idn', 'idnplay', 'idnpoker',
                'daftar', 'link alternatif', 'bo', 'bandar online', 'agen', 'situs', 'terpercaya',
                'resmi', 'terbaik', 'terbesar', 'winrate', 'kemenangan', 'maxwin', 'sensasional',
                'wa.me', 'whatsapp', 'telegram', 'line', 'wechat', 'kakao'
            ];
            
            // Filter comments that match Indonesian gambling criteria
            spamList = msg.comments.filter(comment => {
                if (!comment || !comment.text) return false;
                const text = comment.text.toLowerCase();
                const originalText = comment.text;
                
                // Check for Indonesian gambling keywords
                const containsGamblingKeywords = indonesianGamblingKeywords.some(keyword => 
                    text.includes(keyword.toLowerCase())
                );
                
                // Check for URLs and contact information patterns
                const containsContactInfo = /wa\.me|whatsapp|telegram|line|wechat|t\.me|https?:\/\/|www\.|\.com|\.net|\.id|\.xyz|\.me|\.site|bit\.ly/i.test(text);
                
                // Check for typical Indonesian gambling patterns
                const containsGamblingPatterns = /\bbo\s+\w+|\bslot\s+\w+|\bjudi\s+\w+|\btogel\s+\w+|\bagen\s+\w+|\bsitus\s+\w+|\blink\s+\w+|daftar\s+\w+|minimal\s+deposit|bonus\s+\w+|rtp\s+\w+|gacor\s+\w+/i.test(text);
                
                // Check for number patterns that might be contact info
                const containsNumberPatterns = /\+62|\b62\d{9,}|\b08\d{8,}|\b8\d{8,}/i.test(text);
                
                // Check if comment contains any blocked words from user's list
                const containsBlockedWords = blockedWordsArray.some(word => {
                    if (!word || word.trim() === '') return false;
                    return text.includes(word.toLowerCase().trim());
                });
                
                // Check for unusual formatting (more important when no custom keywords are provided)
                const hasAbnormalFormatting = hasUnusualFormatting(originalText);
                const hasExcessiveEmojis = countEmojis(originalText) > 4;
                const hasRepeatedChars = hasRepeatedCharacters(originalText, 4);
                const hasUnusualChars = hasUnusualCharacterDistribution(originalText);
                
                // Determine if this is likely an Indonesian gambling spam comment
                let isIndonesianGamblingSpam;
                
                if (hasCustomKeywords) {
                    // If user has provided custom keywords, prioritize those
                    isIndonesianGamblingSpam = (containsGamblingKeywords && (containsContactInfo || containsNumberPatterns)) || 
                                              (containsGamblingPatterns && containsContactInfo) ||
                                              containsBlockedWords;
                } else {
                    // If no custom keywords, focus more on detecting abnormal formatting typical of spam
                    isIndonesianGamblingSpam = (containsGamblingKeywords && (containsContactInfo || containsNumberPatterns)) || 
                                              (containsGamblingPatterns && containsContactInfo) ||
                                              (hasAbnormalFormatting && (containsContactInfo || containsNumberPatterns)) ||
                                              (hasExcessiveEmojis && containsContactInfo) ||
                                              (hasRepeatedChars && containsContactInfo) ||
                                              (hasUnusualChars && containsContactInfo);
                }
                
                // Store the reasons why this was flagged as spam
                if (isIndonesianGamblingSpam) {
                    comment.spamReasons = [];
                    if (containsGamblingKeywords) comment.spamReasons.push('Contains gambling keywords');
                    if (containsContactInfo) comment.spamReasons.push('Contains contact information or URLs');
                    if (containsGamblingPatterns) comment.spamReasons.push('Contains gambling patterns');
                    if (containsNumberPatterns) comment.spamReasons.push('Contains phone number patterns');
                    if (containsBlockedWords) comment.spamReasons.push('Contains blocked words');
                    if (hasAbnormalFormatting) comment.spamReasons.push('Contains unusual text formatting');
                    if (hasExcessiveEmojis) comment.spamReasons.push('Contains excessive emojis');
                    if (hasRepeatedChars) comment.spamReasons.push('Contains repeated characters');
                    if (hasUnusualChars) comment.spamReasons.push('Contains unusual character distribution');
                }
                
                return isIndonesianGamblingSpam;
            });
            
            // Update scan statistics
            lastScanStats.spamDetected = spamList.length;
            console.log(`Found ${spamList.length} Indonesian gambling spam comments`);
            
            // Store statistics for future reference
            chrome.storage.local.set({ lastScanStats });
            
            // Send the filtered spam list to popup
            setTimeout(() => {
                const message = { 
                    action: 'showSpam', 
                    comments: spamList,
                    stats: lastScanStats
                };
                
                // Try to send message to popup
                console.log("Attempting to send showSpam message to popup");
                sendMessageToExtensionViews(message);
                
                // Also get the active tab and send a message to the content script
                chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
                    if (tabs && tabs[0] && tabs[0].id) {
                        chrome.tabs.sendMessage(tabs[0].id, {
                            action: 'spamProcessed',
                            count: spamList.length
                        }).catch(error => console.log("Content script may not be listening"));
                    }
                });
                
                if (sendResponse) {
                    sendResponse({success: true, spamCount: spamList.length});
                }
            }, 500); // Small delay to ensure popup is ready
        });
        
        return true; // Keep the message channel open for async response
    }
    
    // Forward other messages to ensure they reach the popup
    if (['notify', 'reloadTab'].includes(msg.action)) {
        sendMessageToExtensionViews(msg);
    }
    
    return true; // Keep the message channel open
});