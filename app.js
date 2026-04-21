import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, collection, addDoc, onSnapshot, query, orderBy, updateDoc, doc, where } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";
import { 
    getAuth, 
    sendSignInLinkToEmail, 
    isSignInWithEmailLink, 
    signInWithEmailLink, 
    GoogleAuthProvider, 
    OAuthProvider, 
    signInWithPopup,
    signOut,  
    onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";



const firebaseConfig = {
    apiKey: "AIzaSyByWPifZOBf2n8QlQsMwcTrOR1eLiZDpWM",
    authDomain: "joyassured-85bbc.firebaseapp.com",
    projectId: "joyassured-85bbc",
    storageBucket: "joyassured-85bbc.firebasestorage.app",
    messagingSenderId: "362012284017",
    appId: "1:362012284017:web:54b52438dccaed93a637d0"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const storage = getStorage(app);
const auth = getAuth(app); 

onAuthStateChanged(auth, (user) => {
    const loginBtn = document.getElementById('loginBtn');
    const isHomePage = window.location.pathname.endsWith('index.html') || 
                           window.location.pathname === '/' || 
                           window.location.pathname === '';
        
        // Only redirect if they are trying to access a restricted dashboard without being logged in
        if (!isHomePage && (window.location.pathname.includes('worker') || window.location.pathname.includes('client'))) {
            window.location.href = 'index.html';
        }
   });

// Check for invitation parameters in the URL
// --- URL & INVITATION LOGIC ---
const urlParams = new URLSearchParams(window.location.search);
const invitedEmail = urlParams.get('assignee');

if (invitedEmail) {
    localStorage.setItem('invitedAs', invitedEmail);
    console.log("Worker invited as: " + invitedEmail);
}


// THE JOYASSURED BACKBONE ENGINE
const GEMINI_KEY = "AIzaSyDGxASkRXPzYlnRz3oDBsqNnQSx7QgfUpY";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash:generateContent?key=${GEMINI_KEY}`;

async function verifyWorkWithAI(base64Image, taskDescription) {
    const statusLabel = document.getElementById('aiStatusText');
    const urlParams = new URLSearchParams(window.location.search);
    const projectId = urlParams.get('project'); // Gets the project ID from the URL link

    if (!projectId) {
        statusLabel.innerText = "⚠️ ERROR: PROJECT ID MISSING";
        return;
    }

    statusLabel.innerText = "🔍 ANALYZING EVIDENCE...";

    const payload = {
        contents: [{
            parts: [
                { text: `SYSTEM: You are the JoyAssured Auditor. 
                         TASK: "${taskDescription}".
                         RULES: 
                         1. If this is a photo of a laptop/phone screen or a screenshot, FAIL it.
                         2. If it is a receipt, verify it is for the correct amount and dated today.
                         3. Verify the physical work matches the task.
                         OUTPUT: Reply exactly with "VERIFIED" or "FAILED: [Reason]".` },
                { inline_data: { mime_type: "image/jpeg", data: base64Image } }
            ]
        }]
    };

    try {
        const response = await fetch(GEMINI_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await response.json();
        
        if (!data.candidates || !data.candidates[0].content.parts[0].text) {
            throw new Error("Invalid AI Response");
        }

        const verdict = data.candidates[0].content.parts[0].text;

        if (verdict.includes("VERIFIED")) {
            statusLabel.innerText = "✅ APPROVED";
            
            // --- CRITICAL: UPDATE THE DATABASE ---
            // This moves the project into your Admin "Ready to Pay" list
            await updateDoc(doc(db, "projects", projectId), {
                status: "Evidence Submitted",
                aiVerdict: "VERIFIED",
                completedAt: new Date()
            });

            alert("Work Verified! The client and admin have been notified for payout.");
            
        } else {
            statusLabel.innerText = "❌ " + verdict;
            
            // Optional: Log the failure so the admin can see why it was rejected
            await updateDoc(doc(db, "projects", projectId), {
                status: "Revision Required",
                aiVerdict: verdict
            });
        }
    } catch (error) {
        statusLabel.innerText = "⚠️ CONNECTION ERROR";
        console.error("Audit failed:", error);
    }
}

// --- NAVIGATION & UI HELPERS ---
function openView(id) { document.getElementById(id)?.classList.remove('hidden'); }
function closeAll() { document.querySelectorAll('.overlay').forEach(m => m.classList.add('hidden')); }

function switchTab(tab) {
    const activeView = document.getElementById('activeView');
    const historyView = document.getElementById('historyView');
    const activeBtn = document.getElementById('activeTab');
    const historyBtn = document.getElementById('historyTab');
    if (tab === 'active') {
        activeView?.classList.remove('hidden'); historyView?.classList.add('hidden');
        activeBtn?.classList.add('active'); historyBtn?.classList.remove('active');
    } else {
        activeView?.classList.add('hidden'); historyView?.classList.remove('hidden');
        activeBtn?.classList.remove('active'); historyBtn?.classList.add('active');
    }
}

function autoExpand(textarea) {
    textarea.style.height = 'inherit';
    textarea.style.height = `${textarea.scrollHeight}px`;
}

// --- CLIENT ACTIONS ---
// --- UPDATED CLIENT ACTIONS ---
async function lockAndDeploy() {
    const title = document.getElementById('pName').value.trim();
    const details = document.getElementById('pDetails').value.trim();
    const netWorkAmount = parseFloat(document.getElementById('pAmount').value);
    const workerId = document.getElementById('pWorkerId').value.toLowerCase().trim();

    // 1. Validation
    if (!title || !details || isNaN(netWorkAmount) || !workerId) {
        return alert("⚠️ Action Blocked: Fill all fields to lock funds.");
    }

    // 2. Calculations
    // Platform Fee: 10% of the work value
    const platformFee = netWorkAmount * 0.10;

    // Withdrawal Buffer: Covers MoMo Agent fees + 0.5% Tax
    // For Uganda, a safe estimate is ~3.5% + 500 UGX for small amounts
    const withdrawBuffer = Math.ceil((netWorkAmount * 0.035) + 500);

    // Total the worker needs to receive so they can withdraw the 'net' amount
    const workerPayout = netWorkAmount + withdrawBuffer;

    // The grand total the client must send to your Merchant Bag
    const totalToDeposit = workerPayout + platformFee;

    const savedName = localStorage.getItem('joyAssuredUser') || "Guest Client";

    // 3. User Confirmation Dialog
    const confirmMsg = 
        `🛡️ JOYASSURED ESCROW BREAKDOWN\n` +
        `--------------------------------\n` +
        `Worker Net Cash: UGX ${netWorkAmount.toLocaleString()}\n` +
        `Withdrawal Charges: UGX ${withdrawBuffer.toLocaleString()}\n` +
        `Safety & Verification: UGX ${platformFee.toLocaleString()}\n` +
        `--------------------------------\n` +
        `TOTAL TO DEPOSIT: UGX ${totalToDeposit.toLocaleString()}\n\n` +
        
       `🛡️ PAYMENT INSTRUCTIONS\n` +
`--------------------------------\n` +
`Pay via Mobile Money:\n\n` +
`📱 MTN Mobile Money\n` +
`Merchant Code: 322575\n\n` +
`📱 Airtel Money\n` +
`Merchant Code: 654321\n\n` +
`After payment, paste your Transaction ID below.`;

    const txId = prompt(confirmMsg);

    if (!txId) return alert("Deposit Cancelled.");

    // 4. Save to Firebase
    try {
        const docRef = await addDoc(collection(db, "projects"), {
            clientName: savedName,
            projectTitle: title,
            requirements: details,
            
            // Financial Ledger
            netWorkAmount: netWorkAmount,    // What the worker gets in cash
            withdrawBuffer: withdrawBuffer,  // Added to payout for fees
            workerPayout: workerPayout,      // TOTAL to send to worker
            serviceFee: platformFee,        // Your JoyAssured profit
            totalDeposited: totalToDeposit,  // Total you expect in MoMo
            
            workerId: workerId,
            clientTxId: txId,
            status: "Awaiting Admin Confirmation",
            timestamp: new Date()
        });

        // 5. Generate Shareable Link
        const shareLink = `${window.location.origin}/index.html?project=${docRef.id}&assignee=${encodeURIComponent(workerId)}`;
        
        // Use your existing share options helper
        showShareOptions(workerId, title, shareLink);
        closeAll();
        
    } catch (e) { 
        console.error("Firebase Error:", e);
        alert("System Error: Could not lock funds. Please check your connection.");
    }
}

function showShareOptions(worker, title, link) {
    // 1. Create a professional, clear message
    const msg = encodeURIComponent(
        `Hello! 🛡️ I've secured UGX funds for "${title}" via JoyAssured.\n\n` +
        `Please click here to view the verification requirements and access your payment dashboard: ${link}`
    );
    
    // 2. Determine if the workerId is a phone number or an email
    const isPhone = /^\+?[0-9]{10,15}$/.test(worker.replace(/\s/g, ''));
    
    if (isPhone) {
        // If it looks like a phone number, prioritize WhatsApp
        if (confirm(`Invite worker (${worker}) via WhatsApp?`)) {
            // Ensure phone number has no spaces/special chars for the URL
            const cleanPhone = worker.replace(/\D/g, '');
            window.open(`https://wa.me/${cleanPhone}?text=${msg}`);
        } else {
            fallbackCopy(link);
        }
    } else {
        // If it's an email, offer to copy for Email/SMS
        if (confirm(`Invite worker via Email/SMS?`)) {
            // Direct attempt to open mail app
            window.open(`mailto:${worker}?subject=Escrow Secured: ${title}&body=${decodeURIComponent(msg)}`);
        } else {
            fallbackCopy(link);
        }
    }
}

// Helper to keep the main function clean
function fallbackCopy(link) {
    copyToClipboard(link);
    alert("Invite link copied to clipboard! You can now paste it directly to the worker.");
}

function copyToClipboard(text) {
    const el = document.createElement('textarea');
    el.value = text;
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
}


// --- STAR RATING & REVIEWS ---
let currentRatings = {};
function setRating(val, projectId) {
    currentRatings[projectId] = val;
    const container = document.querySelector(`[data-project-id="${projectId}"]`);
    const stars = container?.querySelectorAll('.star');
    stars?.forEach((star, index) => {
        star.innerHTML = index < val ? '★' : '☆';
        index < val ? star.classList.add('active') : star.classList.remove('active');
    });
}

function submitFinalReview(projectId) {
    const rating = currentRatings[projectId] || 0;
    const comment = document.getElementById(`feedbackText-${projectId}`)?.value;
    if (rating === 0) return alert("Please select a star rating!");
    
    document.getElementById(`reviewArea-${projectId}`).innerHTML = `
        <div style="background: rgba(3, 226, 157, 0.05); padding: 15px; border-radius: 15px; text-align: center;">
            <p style="color: var(--accent); font-weight: 800; margin: 0;">Review Secured!</p>
            <p class="small-muted">Thank you for building trust in JoyAssured.</p>
        </div>`;
}

// Legacy Feedback function for simple prompts
function submitProjectFeedback(projectId) {
    const feedback = prompt("How did JoyAssured perform on this project?");
    if (feedback) alert("Thank you! Your feedback helps us improve.");
}

// --- WORKER ACTIONS & AI ---



function updateWorkerInstructions(clientText, adminText) {
    document.getElementById('clientInstructions').innerText = clientText;
    document.getElementById('adminGuidance').innerText = adminText;
}

// --- ADMIN ACTIONS ---
function notifyParties(projectId, action, details = "") {
    if (action === 'verified') alert("Notification: Project verified! Funds released.");
    else if (action === 'redo') alert(`Notice: Redo requested. Reason: ${details}`);
}

function verify(action, id) {
    const statusTag = document.querySelector('.status-tag');
    const actionArea = document.querySelector('.admin-actions');

    if (action === 'pay') {
        if (confirm("CRITICAL: Confirm GPS/AI? Releases UGX funds.")) {
            if(statusTag) { statusTag.innerText = "FUNDS RELEASED"; statusTag.style.background = "var(--accent)"; }
            if(actionArea) actionArea.innerHTML = `<p style="color: var(--accent); font-weight: 800;">✅ Transaction Finalized</p>`;
            notifyParties(id, 'verified');
            window.open(`https://wa.me/?text=JoyAssured: Project ${id} Verified. Funds released!`);
        }
    } else if (action === 'redo') {
        const reason = prompt("Why is a redo needed?");
        if (reason) {
            notifyParties(id, 'redo', reason);
            window.open(`https://wa.me/?text=JoyAssured: Redo required for ${id}. Reason: ${reason}`);
        }
    } else if (action === 'refund') {
        if (confirm("Return funds to Client?")) { alert("Funds returned."); window.location.reload(); }
    }
}

/*  // In app.js
const video = document.getElementById('video');
if (!video || video.readyState !== 4) return alert("Camera still warming up...");  */


function listenForProjects() {
    const q = query(collection(db, "projects"), orderBy("timestamp", "desc"));
    onSnapshot(q, (snapshot) => {
        const adminView = document.getElementById('adminProjectList');
        if (!adminView) return;
        adminView.innerHTML = "";
        
        snapshot.forEach((doc) => {
            const data = doc.data();
            const id = doc.id;
            
            // 1. DYNAMIC FINANCIAL MAPPING 
            // Ensures legacy data (budget) or new data (netWorkAmount) both work
            const total = data.totalDeposited ? Number(data.totalDeposited).toLocaleString() : "0";
            const payout = data.workerPayout ? Number(data.workerPayout).toLocaleString() : "0";
            const profit = data.serviceFee ? Number(data.serviceFee).toLocaleString() : "0";
            const workerNet = data.netWorkAmount ? Number(data.netWorkAmount).toLocaleString() : "0";

            // 2. STATUS COLOR LOGIC
            let statusColor = "#666"; // Default Gray
            let cardBorder = "1px solid var(--glass-border)";
            
            if (data.status === "Awaiting Admin Confirmation") {
                statusColor = "#f39c12"; // Warning Orange
                cardBorder = "2px solid #f39c12";
            } else if (data.status === "Evidence Submitted" || data.status === "VERIFIED") {
                statusColor = "var(--accent)"; 
                cardBorder = "2px solid var(--accent)";
            } else if (data.status === "Funds Released") {
                statusColor = "#27ae60"; // Success Green
            }

            adminView.innerHTML += `
                <div class="glass-card" style="margin-bottom:20px; border: ${cardBorder};">
                    <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                        <div>
                            <strong style="font-size: 1.1rem; display: block;">${data.projectTitle || "Untitled Project"}</strong>
                            <p class="small-muted">Client: ${data.clientName || "Anonymous"}</p>
                        </div>
                        <span class="status-tag" style="background: ${statusColor}15; color: ${statusColor}; border: 1px solid ${statusColor}30;">
                            ${data.status}
                        </span>
                    </div>
                    
                    <div style="margin: 15px 0; padding: 12px; background: rgba(0,0,0,0.03); border-radius: 12px; font-size: 0.85rem;">
                        <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                            <span>💰 Total Recv (MoMo):</span>
                            <strong style="color: var(--text-main);">UGX ${total}</strong>
                        </div>
                        <div style="display: flex; justify-content: space-between; margin-bottom: 8px; color: #2e7d32;">
                            <span>👷 Payout (Inc. Buffer):</span>
                            <strong>UGX ${payout}</strong>
                        </div>
                        <div style="display: flex; justify-content: space-between; color: var(--accent); border-top: 1px solid #ddd; pt-8; margin-top: 8px; padding-top: 8px;">
                            <span>📈 JoyAssured Profit:</span>
                            <strong>UGX ${profit}</strong>
                        </div>
                    </div>
                    
                    <div class="admin-actions">
                        ${data.status === 'Awaiting Admin Confirmation' ? `
                            <div style="background: #fff9e6; padding: 10px; border-radius: 10px; border: 1px solid #ffeaa7;">
                                <p class="small" style="margin-bottom: 10px;">Check MoMo for ID: <b>${data.clientTxId}</b></p>
                                <button class="primary-btn" style="width:100%;" onclick="confirmEscrowDeposit('${id}')">Confirm & Secure Funds</button>
                            </div>
                        ` : ''}

                        ${(data.status === 'Evidence Submitted' || data.status === 'VERIFIED') ? `
                            <div style="background: #e6f9ed; padding: 10px; border-radius: 10px; border: 1px solid #b2f2bb;">
                                <p class="small" style="margin-bottom: 5px;"><b>PAYMENT ACTION REQUIRED</b></p>
                                <p class="small-muted" style="margin-bottom: 10px;">Send to: ${data.workerId}</p>
                                <button class="primary-btn" style="width:100%; background: #2e7d32;" onclick="releaseToWorker('${id}', '${data.workerPayout}')">Confirm MoMo Sent</button>
                            </div>
                        ` : ''}

                        ${data.status === 'Funds Released' ? `
                            <p style="text-align: center; color: #27ae60; font-weight: 800; margin: 10px 0;">✅ TRANSACTION COMPLETED</p>
                            <p class="small-muted" style="text-align: center;">Payout ID: ${data.payoutTxId || 'Verified'}</p>
                        ` : ''}
                    </div>
                </div>`;
        });
    });
}


// This starts the listeners only on the correct pages
if (window.location.pathname.includes('admin.html')) {
    listenForProjects();
}

if (window.location.pathname.includes('worker.html')) {
    listenForWorkerTasks();
}


// --- COMPLETE EXPOSE TO WINDOW BLOCK ---
window.openView = openView; 
window.closeAll = closeAll; 
window.switchTab = switchTab;
window.autoExpand = autoExpand; 
window.lockAndDeploy = lockAndDeploy;
window.setRating = setRating; 
window.submitFinalReview = submitFinalReview;
window.submitProjectFeedback = submitProjectFeedback; 
window.startCapture = startCapture;
window.closeCamera = closeCamera; 
window.processAISubmission = processAISubmission;
window.updateWorkerInstructions = updateWorkerInstructions; 
window.verify = verify;
window.listenForWorkerTasks = listenForWorkerTasks;
window.confirmEscrowDeposit = confirmEscrowDeposit;
window.releaseToWorker = releaseToWorker;
window.socialLogin = socialLogin;
window.handleAuth = handleAuth;
window.switchMode = switchMode;
window.openAuth = openAuth;
window.closeAuth = closeAuth;
window.selectRole = selectRole;
window.openPopup = openPopup;
window.closePopup = closePopup;

if (window.location.pathname.includes('admin.html')) listenForProjects();

// --- WORKER ACTIONS & AI ---

// 1. Start the Camera
async function startCapture(mode = 'progress') {
    const cameraHeader = document.getElementById('cameraMode');
    if(cameraHeader) {
        cameraHeader.innerText = mode === 'final' ? "📸 CAPTURING FINAL EVIDENCE" : "🏗️ CAPTURING PROGRESS UPDATE";
    }
    
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
            video: { facingMode: "environment" } 
        });
        document.getElementById('video').srcObject = stream;
        openView('scannerUI');
    } catch (err) { 
        alert("Camera and Location access are required for verification."); 
    }
}

// 2. The Big Action Button (Triggered by 'Verify Now')
async function processAISubmission() {
    const statusText = document.getElementById('aiStatusText');
    const videoFeed = document.getElementById('video');
    const urlParams = new URLSearchParams(window.location.search);
    const projectId = urlParams.get('project');

    if (!projectId) {
        return alert("❌ Error: Project ID not found. Use the link from your WhatsApp/Email.");
    }

    statusText.innerText = "🛰️ LOCKING GPS...";
    
    // Get GPS
    const position = await new Promise((resolve) => {
        navigator.geolocation.getCurrentPosition(resolve, () => resolve(null), { 
            enableHighAccuracy: true, timeout: 5000 
        });
    });

    if (!position) {
        return alert("GPS required for payment verification.");
    }

    // Capture Image
    const canvas = document.createElement('canvas');
    canvas.width = videoFeed.videoWidth;
    canvas.height = videoFeed.videoHeight;
    canvas.getContext('2d').drawImage(videoFeed, 0, 0);

    statusText.innerText = "📤 UPLOADING TO VAULT...";

    canvas.toBlob(async (blob) => {
        const fileName = `evidence/${projectId}_${Date.now()}.jpg`;
        const fileRef = ref(storage, fileName);

        try {
            // Upload to Storage
            await uploadBytes(fileRef, blob, {
                customMetadata: {
                    'lat': position.coords.latitude.toString(),
                    'lng': position.coords.longitude.toString(),
                    'projectId': projectId
                }
            });

            // Read for AI
            const reader = new FileReader();
            reader.readAsDataURL(blob);
            reader.onloadend = () => {
                const base64Data = reader.result.split(',')[1];
                // GET THE TEXT INJECTED BY listenForWorkerTasks
                const taskDesc = document.getElementById('clientInstructions')?.innerText || "Verify work";
                
                statusText.innerText = "🤖 AI AUDITING...";
                verifyWorkWithAI(base64Data, taskDesc); 
                
                // Close camera after a short delay so they see the result
                setTimeout(closeCamera, 2000);
            };

        } catch (error) {
            statusText.innerText = "⚠️ UPLOAD ERROR";
            console.error(error);
        }
    }, 'image/jpeg', 0.8);
}

function closeCamera() {
    const video = document.getElementById('video');
    if (video.srcObject) video.srcObject.getTracks().forEach(track => track.stop());
    document.getElementById('scannerUI').classList.add('hidden');
}


// Auth Logic
let currentMode = 'login';
let selectedRole = null;

function openAuth() { 
    document.getElementById('authModal').classList.remove('hidden');
    // Default to Sign Up for a better first-time experience
    switchMode('signup'); 
}

function closeAuth() { document.getElementById('authModal').classList.add('hidden'); }

function selectRole(role) {
    selectedRole = role;
    document.getElementById('roleClient').classList.toggle('selected', role === 'client');
    document.getElementById('roleWorker').classList.toggle('selected', role === 'worker');
    document.getElementById('formFields').classList.remove('hidden');
}


// 2. Updated socialLogin Function
async function socialLogin(providerName) {
    // Safety check: ensure the user picked a role first
    if (!selectedRole) {
        alert("Please select a role (Project Owner or Professional) before signing in.");
        return;
    }

    let provider;
    if (providerName === 'google') {
        provider = new GoogleAuthProvider();
    } else if (providerName === 'apple') {
        provider = new OAuthProvider('apple.com');
    }

    try {
        const result = await signInWithPopup(auth, provider);
        const user = result.user;
        
        // Save user info for personalizing the dashboard later
        localStorage.setItem('joyAssuredUser', user.email);
        localStorage.setItem('joyAssuredRole', selectedRole);
        
        // Seamless redirect based on their chosen role
        if (selectedRole === 'client') {
            window.location.href = 'client.html';
        } else {
            window.location.href = 'worker.html';
        }
    } catch (error) {
        // Handle common errors (like user closing the popup) gracefully
        if (error.code === 'auth/popup-closed-by-user') {
            console.log("User closed the sign-in popup.");
        } else {
            console.error("Social Auth Error:", error);
            alert("Authentication failed: " + error.message);
        }
    }
}

// 3. Re-expose to window so the HTML buttons can find it
window.socialLogin = socialLogin;



// Attach to window so TrebEdit's HTML onclicks work
// 1. The Function Logic
function switchMode(mode) {
    currentMode = mode; // Make sure this line exists
    const loginTab = document.getElementById('loginTab');
    const signupTab = document.getElementById('signupTab');
    const actionBtn = document.getElementById('actionBtn');

    if (mode === 'login') {
        loginTab.classList.add('active');
        signupTab.classList.remove('active');
        actionBtn.innerText = "Log In";
    } else {
        loginTab.classList.remove('active');
        signupTab.classList.add('active');
        actionBtn.innerText = "Sign Up & Verify";
    }
}


// 2. The Bridge (CRITICAL: Add this at the end of app.js)
window.switchMode = switchMode;
window.openAuth = openAuth; 
window.closeAuth = closeAuth;
window.selectRole = selectRole;

// 2. Updated handleAuth Function
async function handleAuth() {
    const id = document.getElementById('userIdentifier').value;
    const actionBtn = document.getElementById('actionBtn');

    // Validation
    if (!id || !selectedRole) {
        alert("Please select your role (Project Owner or Professional) and enter your email!");
        return;
    }

    // Check if it's an email (Passwordless login works best with email)
    if (!id.includes('@')) {
        alert("For secure verification, please use a valid email address.");
        return;
    }

    actionBtn.innerText = "Sending Link...";
    actionBtn.disabled = true;

    const actionCodeSettings = {
        // This redirects them back to JoyAssured after they click the email link
        url: window.location.origin + window.location.pathname, 
        handleCodeInApp: true,
    };

    try {
        await sendSignInLinkToEmail(auth, id, actionCodeSettings);
        
        // Save these locally so we remember who they are when they come back from their email
        window.localStorage.setItem('emailForSignIn', id);
        window.localStorage.setItem('joyAssuredRole', selectedRole);
        window.localStorage.setItem('joyAssuredUser', id); 

        alert(`Success! A secure login link has been sent to ${id}. Please check your inbox (and spam folder) to verify your account.`);
        closeAuth(); // Close the modal while they check email
    } catch (error) {
        console.error("Auth Error:", error);
        alert("Verification failed: " + error.message);
    } finally {
        actionBtn.innerText = "Verify";
        actionBtn.disabled = false;
    }
}

// 3. CRITICAL: Re-expose to window because app.js is a module
window.handleAuth = handleAuth;



// Step 1: Confirm the money is in your Merchant Wallet
async function confirmEscrowDeposit(projectId) {
    if (confirm("Have you received the SMS for this transaction on your phone?")) {
        await updateDoc(doc(db, "projects", projectId), {
            status: "Funds Secured",
            adminConfirmedAt: new Date()
        });
        alert("Escrow Secured. Worker can now see the balance.");
    }
}

// Step 2: Record that you sent the money to the worker
async function releaseToWorker(projectId, amount) {
    const payoutId = prompt(`Enter the Transaction ID from the SMS after paying UGX ${amount} to the worker:`);
    
    if (payoutId) {
        await updateDoc(doc(db, "projects", projectId), {
            status: "Funds Released",
            payoutTxId: payoutId,
            completedAt: new Date()
        });
        alert("Project Completed. Ledger updated.");
    }
}

// Expose these to the window
window.confirmEscrowDeposit = confirmEscrowDeposit;
window.releaseToWorker = releaseToWorker;


// 2. EXPOSE TO HTML (Add this at the bottom of app.js)

// Function to open any popup by ID
function openPopup(id) {
    document.getElementById(id).classList.remove('hidden');
}

// Function to close any popup by ID
function closePopup(id) {
    document.getElementById(id).classList.add('hidden');
}

// Check if the user just arrived from an email link
if (isSignInWithEmailLink(auth, window.location.href)) {
    let email = window.localStorage.getItem('emailForSignIn');
    const role = window.localStorage.getItem('joyAssuredRole');

    // If the user opened the link on a different device, ask for email again
    if (!email) {
        email = window.prompt('Please confirm your email for verification:');
    }

    signInWithEmailLink(auth, email, window.location.href)
        .then(() => {
            window.localStorage.removeItem('emailForSignIn');
            // Redirect to the correct dashboard based on the saved role
            if (role === 'client') {
                window.location.href = 'client.html';
            } else {
                window.location.href = 'worker.html';
            }
        })
        .catch((error) => {
            console.error("Error finalizing sign-in:", error);
            alert("Session expired or link already used.");
        });
}


function listenForWorkerTasks() {
    const workerEmail = localStorage.getItem('joyAssuredUser')?.toLowerCase().trim();
    if (!workerEmail) return;

    const q = query(collection(db, "projects"), where("workerId", "==", workerEmail), orderBy("timestamp", "desc"));

    onSnapshot(q, (snapshot) => {
        const taskList = document.getElementById('workerTaskList');
        const instructionBox = document.getElementById('instructionBox');
        const clientInstructions = document.getElementById('clientInstructions');
        
        if (!taskList) return;
        taskList.innerHTML = "";

        snapshot.forEach((doc) => {
            const data = doc.data();
            
            // This FIXES point #1: It fills the instruction box for the AI
            if (clientInstructions) {
                clientInstructions.innerText = data.requirements;
                instructionBox?.classList.remove('hidden');
            }

            // This FIXES point #2: Uses netWorkAmount instead of budget
            taskList.innerHTML += `
                <div class="glass-card success-border" style="margin-bottom: 20px;">
                    <div style="display: flex; justify-content: space-between;">
                        <h4 style="margin: 0; color: var(--accent);">${data.projectTitle}</h4>
                        <span class="status-tag">${data.status}</span>
                    </div>
                    <div style="padding: 12px; background: rgba(0,0,0,0.03); border-radius: 12px; margin-top: 10px;">
                        <p class="small">CASH IN HAND:</p>
                        <p style="font-weight: 800; color: var(--accent);">UGX ${Number(data.netWorkAmount || 0).toLocaleString()}</p>
                    </div>
                </div>`;
        });
    });
}


if (window.location.pathname.includes('admin.html')) {
    listenForProjects();
}

if (window.location.pathname.includes('worker.html')) {
    listenForWorkerTasks();
}

const logoutBtn = document.getElementById('logoutBtn');
// AT THE VERY BOTTOM OF APP.JS
if (logoutBtn) {
    logoutBtn.onclick = async (e) => {
        e.preventDefault(); // Stops the browser from glitching the CSS
        
        try {
            await signOut(auth);
            
            // Clear EVERYTHING to ensure the UI resets
            localStorage.clear(); 
            sessionStorage.clear();

            // Use replace instead of href to prevent the "back" button 
            // from showing a 'ghost' of the logged-in dashboard
            window.location.replace('index.html'); 
            
        } catch (error) {
            alert("Logout failed: " + error.message);
        }
    };
}

window.openAuth = openAuth;
window.closeAuth = closeAuth;
window.openPopup = openPopup;
window.closePopup = closePopup;
window.switchMode = switchMode;
window.selectRole = selectRole;
window.handleAuth = handleAuth;
window.socialLogin = socialLogin;
