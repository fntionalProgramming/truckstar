lucide.createIcons();
const API_BASE = "http://localhost:5000/api";
const bounds = L.latLngBounds(
    L.latLng(-89.98155760646617, -180),
    L.latLng(89.99346179538875, 180)
);
const map = L.map("map", {
    zoomControl: false,
    minZoom: 3,
    maxBounds: bounds,
    maxBoundsViscosity: 1.0
}).setView([39.8283, -98.5795], 4);
const streetLayer = L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
    {
        maxZoom: 19,
        attribution:
            "Tiles &copy; Esri &mdash; Source: Esri, DeLorme, NAVTEQ, USGS, Intermap, iPC, NRCAN, etc."
    }
).addTo(map);
const satelliteLayer = L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    {
        maxZoom: 19,
        attribution:
            "Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community"
    }
);
const satelliteLabelsLayer = L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
    { maxZoom: 19 }
);
const truckIcon = L.divIcon({
    html: `
        <div class="bg-emerald-500 p-2 rounded-full border-2 border-slate-900 shadow-xl text-slate-900">
            <svg xmlns="http://www.w3.org/2000/svg"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round">

                <path d="M10 17h4V5H2v12h3"/>
                <path d="M20 17h2v-3.34a4 4 0 0 0-1.17-2.83L19 9h-5"/>
                <path d="M14 17h1"/>
                <circle cx="7.5" cy="17.5" r="2.5"/>
                <circle cx="17.5" cy="17.5" r="2.5"/>
            </svg>
        </div>
    `,
    className: "",
    iconSize: [36, 36],
    iconAnchor: [18, 18]
});
const redTruckIcon = L.divIcon({
    html: `
        <div class="bg-red-500 p-2 rounded-full border-2 border-slate-900 shadow-xl text-white">
            <svg xmlns="http://www.w3.org/2000/svg"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round">

                <path d="M10 17h4V5H2v12h3"/>
                <path d="M20 17h2v-3.34a4 4 0 0 0-1.17-2.83L19 9h-5"/>
                <path d="M14 17h1"/>
                <circle cx="7.5" cy="17.5" r="2.5"/>
                <circle cx="17.5" cy="17.5" r="2.5"/>
            </svg>
        </div>
    `,
    className: "",
    iconSize: [36, 36],
    iconAnchor: [18, 18]
});

/*
Applicaiton state
*/
let markers = {};
let driverMarkers = {};
let routePolylines = {};
let selectedLoad = null;
let activeWatchId = null;
let allLoadedData = [];
const sheet = document.getElementById("load-sheet");

async function api(path, options = {}) {
    const response = await fetch(`${API_BASE}${path}`, {
        ...options,
        headers: {
            "Content-Type": "application/json",
            ...(options.headers || {})
        }
    });
    const text = await response.text();
    let data; 
    try {
        data = JSON.parse(text)
    } catch {
        throw new Error(`Server returned ${response.status}: ${text}`);
    }
    if (!response.ok) {throw new Error(data.error || data.message || `Request faied (${response.status})`);}
    return data;
}

let currentRole = localStorage.getItem("empty_mile_role") || "company";
let activeDriverName = localStorage.getItem("empty_mile_driver_name") || "";
const roleCompanyBtn = document.getElementById("role-company-btn");
const roleDriverBtn = document.getElementById("role-driver-btn");
const driverIdentityContainer = document.getElementById("driver-identity-container");
const activeDriverInput = document.getElementById("active-driver-name");
activeDriverInput.value = activeDriverName;

function updateRoleUI() {
    if (currentRole === "company") {
        roleCompanyBtn.className = "flex-1 bg-emerald-600 text-white text-xs font-bold py-2.5 rounded-xl transition";
        roleDriverBtn.className = "flex-1 bg-slate-700 text-slate-300 text-xs font-bold py-2.5 rounded-xl transition";
        driverIdentityContainer.classList.add("hidden");
    } else {
        roleDriverBtn.className = "flex-1 bg-emerald-600 text-white text-xs font-bold py-2.5 rounded-xl transition";
        roleCompanyBtn.className = "flex-1 bg-slate-700 text-slate-300 text-xs font-bold py-2.5 rounded-xl transition";
        driverIdentityContainer.classList.remove("hidden");
    }
}

updateRoleUI();

roleCompanyBtn.addEventListener("click", () => {
    currentRole = "company";
    localStorage.setItem(
        "empty_mile_role",
        "company"
    );
    updateRoleUI();
    fetchAllLoads();
    logNotification("Switched to Company Mode");
});

roleDriverBtn.addEventListener("click", () => {
    currentRole = "driver";
    localStorage.setItem("empty_mile_role", "driver");
    updateRoleUI();
    logNotification("Switched to Driver Mode");
});

activeDriverInput.addEventListener("input", (e) => {
    activeDriverName = e.target.value.trim();
    localStorage.setItem("empty_mile_driver_name", activeDriverName);
});

const satelliteToggleBtn = document.getElementById("satellite-toggle-btn");
let isSatelliteView = false;
satelliteToggleBtn.addEventListener("click", () => {
    isSatelliteView = !isSatelliteView;
    if (isSatelliteView) {
        map.removeLayer(streetLayer);
        satelliteLayer.addTo(map);
        satelliteLabelsLayer.addTo(map);
        satelliteToggleBtn.classList.add("bg-emerald-600");
        satelliteToggleBtn.classList.remove("bg-slate-800", "hover:bg-slate-700");
    } else {
        map.removeLayer(satelliteLayer);
        map.removeLayer(satelliteLabelsLayer);
        streetLayer.addTo(map);
        satelliteToggleBtn.classList.remove("bg-emerald-600");
        satelliteToggleBtn.classList.add("bg-slate-800", "hover:bg-slate-700");
    }
});

const themeToggleBtn = document.getElementById("theme-toggle-btn");
themeToggleBtn.addEventListener("click", () => {
    document.body.classList.toggle("light-theme");
    const isLight = document.body.classList.contains("light-theme");
    themeToggleBtn.innerHTML = isLight ? '<i data-lucide="moon"></i>' : '<i data-lucide="sun"></i>';
    lucide.createIcons();
});

document.getElementById("gps-btn").addEventListener("click", () => {
    if (!navigator.geolocation) {
        alert(
            "Geolocation is not supported by your browser"
        );
        return;
    }
    navigator.geolocation.getCurrentPosition(
        pos => {
            map.setView([pos.coords.latitude, pos.coords.longitude], 12);
        },
        () => {
            alert("Unable to retrieve your location.");
        }
    );
});

const NOTI_KEY = "empty_mile_notifications";
function getStoredNotis() {
    return JSON.parse(localStorage.getItem(NOTI_KEY) || "[]");
}

function saveNotis(notis) {
    localStorage.setItem(NOTI_KEY, JSON.stringify(notis));
    document.getElementById("noti-badge").classList.toggle("hidden", notis.length === 0);
}

function showToast(message) {
    const toast = document.getElementById("toast-notification");
    document.getElementById("toast-message").innerText = message;
    toast.classList.remove("hidden");
    setTimeout(() => {toast.classList.add("hidden");}, 4000);
}

function logNotification(message) {
    const notis = getStoredNotis();
    const timeString =new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit"
    });
    notis.unshift({
        id: Date.now(),
        message,
        time: timeString
    });
    saveNotis(notis);
    renderNotifications();
    showToast(message);
}

function renderNotifications() {
    const list =document.getElementById("noti-list");
    const notis = getStoredNotis();
    if (notis.length === 0) {
        list.innerHTML = `
            <div class="text-slate-500 text-sm text-center mt-10 italic">
                No notification history.
            </div>
        `;
        return;
    }
    list.innerHTML = notis.map(n => `
        <div
            class="relative rounded-xl bg-red-600 noti-item"
            data-id="${n.id}"
        >
            <div class="absolute inset-y-0 right-0 flex items-center justify-end px-4 w-full">
                <button
                    class="text-white font-bold"
                    onclick="deleteNotification(${n.id})"
                >
                    <i data-lucide="trash-2"></i>
                </button>
            </div>

            <div
                class="swipe-content relative bg-slate-800 border border-slate-700 p-3 rounded-xl transition-transform duration-200 flex flex-col"
                style="touch-action: pan-y;"
            >
                <div class="text-sm text-slate-200 font-medium">
                    ${n.message}
                </div>

                <div class="text-xs text-slate-500 mt-1">
                    ${n.time}
                </div>
            </div>
        </div>
    `).join("");
    lucide.createIcons();
    attachSwipeListeners();
}

window.deleteNotification = function (id) {
    saveNotis(getStoredNotis().filter(n => n.id !== id));
    renderNotifications();
};

function attachSwipeListeners() {
    document.querySelectorAll(".noti-item").forEach(item => {
        const content = item.querySelector(".swipe-content");
        let startX = 0;
        let currentX = 0;
        content.addEventListener("touchstart", e => {
            startX = e.touches[0].clientX;
            content.style.transition = "none";
        }, { passive: true });
        content.addEventListener("touchmove", e => {
            currentX = e.touches[0].clientX - startX;
            if (currentX < -10) {
                content.style.transform =`translateX(${Math.max(currentX, -80)}px)`;
            }
        }, { passive: true });
        content.addEventListener("touchend", () => {
            content.style.transition ="transform 0.2s";
            if (currentX < -40) {
                content.style.transform = "translateX(-70px)";
            } else {
                content.style.transform = "translateX(0px)";
            }
        });
    });
}

const slideMenu = document.getElementById("slide-menu");
const notiPanel = document.getElementById("noti-panel");
document.getElementById("menu-btn").addEventListener("click", () => {
    slideMenu.classList.toggle("active");
});
document.getElementById("close-menu-btn").addEventListener("click", () => {
    slideMenu.classList.remove("active");
});
document.getElementById("menu-open-dispatch").addEventListener("click", () => {
    slideMenu.classList.remove("active");
    document.getElementById("dispatch-modal").classList.remove("hidden");
});
document.getElementById("close-dispatch-btn").addEventListener("click", () => {
    document.getElementById("dispatch-modal").classList.add("hidden");
});
document.getElementById("close-driver-modal").addEventListener("click", () => {
    document.getElementById("driver-accept-modal").classList.add("hidden");
});
document.getElementById("close-sheet").addEventListener("click", () => {
    sheet.classList.remove("active");
});
document.getElementById("noti-btn").addEventListener("click", () => {
    notiPanel.classList.remove("translate-x-full");
});
document.getElementById("close-noti-panel").addEventListener("click", () => {
    notiPanel.classList.add("translate-x-full");
});
document.getElementById("clear-all-notis").addEventListener("click", () => {
    if (confirm("Delete all notification history forever?")) {
        saveNotis([]);
        renderNotifications();
    }
});

function setupAutocomplete(inputId, suggestionBoxId) {
    const input = document.getElementById(inputId);
    const box =
    document.getElementById(suggestionBoxId);
    if (!input || !box) return;
    let timeout = null;
    input.addEventListener("input", e => {
        const query = e.target.value.trim();
        clearTimeout(timeout);
        if (query.length < 3) {
            box.classList.add("hidden");
            box.innerHTML = "";
            return;
        }
        timeout = setTimeout(async () => {
            try {
                const data = await api(`/autocomplete?q=${encodeURIComponent(query)}`);
                const suggestions = data.suggestions || [];
                if (suggestions.length === 0) {
                    box.classList.add("hidden");
                    return;
                }
                box.innerHTML =
                    suggestions.map(s => `
                        <div
                            class="p-2.5 hover:bg-slate-700 cursor-pointer text-xs text-slate-200 border-b border-slate-700/50 last:border-none"
                            data-lat="${s.lat}"
                            data-lon="${s.lng}"
                            data-text="${s.text}"
                        >
                            ${s.text}
                        </div>
                    `).join("");
                box.classList.remove("hidden");
                box.querySelectorAll("div").forEach(
                    el => {
                        el.addEventListener("click", () => {
                            input.value = el.dataset.text;
                            input.dataset.lat = el.dataset.lat;
                            input.dataset.lon = el.dataset.lon;
                            box.classList.add("hidden");
                        });
                    });
            } catch (error) {
                console.error("Autocomplete error:", error);
            }
        }, 300);
    });
    document.addEventListener("click", e => {
        if (!input.contains(e.target) && !box.contains(e.target)) {
            box.classList.add("hidden");
        }
    });
}

setupAutocomplete("origin", "origin-suggestions");
setupAutocomplete("destination", "dest-suggestions");
document.getElementById("dispatch-form").addEventListener("submit", async e => {
    e.preventDefault();
    try {
        const originInput = document.getElementById("origin");
        const destinationInput = document.getElementById("destination");
        const originText = originInput.value.trim();
        const destinationText = destinationInput.value.trim();
        const originLat = originInput.dataset.lat ? parseFloat(originInput.dataset.lat) : null;
        const originLng = originInput.dataset.lon ? parseFloat(originInput.dataset.lon) : null;
        const destinationLat = destinationInput.dataset.lat ? parseFloat(destinationInput.dataset.lat) : null;
        const destinationLng = destinationInput.dataset.lon ? parseFloat(destinationInput.dataset.lon): null;
        await api("/loads", {
            method: "POST",
            body: JSON.stringify({
                company_name: document.getElementById("company").value,
                payout: document.getElementById("payout").value,
                cargo_description: document.getElementById("cargo").value,
                origin_city: originText,
                destination_city: destinationText,
                lat_coords: originLat,
                lng_coords: originLng,
                dest_lat: destinationLat,
                dest_lng: destinationLng
            })
        });
        document.getElementById("dispatch-modal").classList.add("hidden");
        e.target.reset();
        delete originInput.dataset.lat;
        delete originInput.dataset.lon;
        delete destinationInput.dataset.lat;
        delete destinationInput.dataset.lon;
        logNotification("Load successfully dispatched to map matrix.");
        await fetchAllLoads();
    } catch (error) {
        alert(`Error: ${error.message}`);
    }
});


async function drawRouteLine(loadId, startLat, startLng, endLat, endLng, lineColor = "#3b82f6") {
    try {
        const params = new URLSearchParams({
            start_lat: startLat,
            start_lng: startLng,
            end_lat: endLat,
            end_lng: endLng
        });
        const data = await api(`/route?${params.toString()}`);
        if (!data.coordinates || data.coordinates.length === 0) {
            return;
        }
        if (routePolylines[loadId]) {
            map.removeLayer(routePolylines[loadId]);
        }
        routePolylines[loadId] = L.polyline(data.coordinates, {color: lineColor, weight: 5, opacity: 0.8}).addTo(map);
    } catch (error) {
        console.error(
            "Route error:",
            error
        );
    }
}
function updateCompanyVerificationPanel(loadsList) {
    const container =document.getElementById("company-verification-list");
    if (currentRole !== "company") {
        container.innerHTML = `
            <div class="text-slate-500 text-xs italic">
                Switch to Company Mode to view verification dashboard.
            </div>
        `;
        return;
    }
    const pendingLoads =loadsList.filter(load => load.status === "pending_verification");
    if (pendingLoads.length === 0) {
        container.innerHTML = `
            <div class="text-slate-500 text-xs italic">
                No loads currently pending verification.
            </div>
        `;
        return;
    }
    container.innerHTML =
        pendingLoads.map(load => `
            <div class="bg-slate-900 p-3 rounded-xl border border-slate-700 flex justify-between items-center gap-2">

                <div>
                    <div class="text-white text-xs font-bold">
                        ${load.cargo_description}
                        (${load.company_name})
                    </div>

                    <div class="text-slate-400 text-[10px]">
                        Driver: ${load.driver_name}
                        (Delivered to ${load.destination_city})
                    </div>
                </div>

                <button
                    onclick="verifyAndCloseLoad('${load.id}')"
                    class="bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition"
                >
                    Confirm Delivery
                </button>

            </div>
        `).join("");
}

window.verifyAndCloseLoad =
    async function (loadId) {
        if (currentRole !== "company") {
            alert("Only company accounts can verify and close loads.");
            return;
        }
        try {
            await api(`/loads/${loadId}/verify`,
                {
                    method: "POST"
                }
            );
            logNotification("Load delivery confirmed by company! Live tracking terminated.");
            removeLoadMapObjects(loadId);
            await fetchAllLoads();
        } catch (error) {
            alert(`Error: ${error.message}`);
        }
    };

function removeLoadMapObjects(loadId) {
    if (markers[loadId]) {
        map.removeLayer(markers[loadId]);
        delete markers[loadId];
    }
    if (driverMarkers[loadId]) {
        map.removeLayer(driverMarkers[loadId]);
        delete driverMarkers[loadId];
    }
    if (routePolylines[loadId]) {
        map.removeLayer(routePolylines[loadId]);
        delete routePolylines[loadId];
    }
}

function createOpenLoadMarker(load) {
    if (markers[load.id]) {return;}
    const marker = L.marker([load.lat_coords, load.lng_coords],{icon: truckIcon}).addTo(map);
    marker.on("click", () => {
        selectedLoad = load;
        document.getElementById("sheet-payout").innerText =`$${Number(load.payout).toLocaleString()}`;
        document.getElementById("sheet-company").innerText = load.company_name;
        document.getElementById("sheet-cargo").innerText = load.cargo_description;
        document.getElementById("sheet-origin").innerText = load.origin_city;
        document.getElementById("sheet-dest").innerText = load.destination_city;
        document.getElementById("sheet-action-area").innerHTML = `
            <button
                id="accept-btn"
                class="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-4 rounded-xl transition text-lg shadow-lg shadow-emerald-900/50"
            >
                Accept Load
            </button>
        `;
        document.getElementById("accept-btn").addEventListener("click", () => {
            if (currentRole !== "driver") {
                alert("Switch to Driver Mode to accept a load.")
                return;
            }
            document.getElementById('driver-accept-modal').classList.remove("hidden")
        })
        sheet.classList.add("active");
        map.setView([load.lat_coords - 1.5, load.lng_coords], 6);
    });
    markers[load.id] = marker;
}

function createOrUpdateDriverMarker(load) {
    if (load.driver_lat == null || load.driver_lng == null) {return;}
    if (!driverMarkers[load.id]) {
        const marker = L.marker([load.driver_lat, load.driver_lng], { icon: redTruckIcon }).addTo(map);
        marker.on("click", () => {
            const currentLoad = allLoadedData.find(l => l.id === load.id) || load;
            const isAssignedDriver =
                currentRole === "driver" && activeDriverName && currentLoad.driver_name && currentLoad.driver_name.toLowerCase() === activeDriverName.toLowerCase();
            if (isAssignedDriver) {
                openDriverSheet(currentLoad);
            } else {
                marker.bindPopup(`
                        <b>Status: ${currentLoad.status.replace("_", " ")}</b>
                        <br>
                        Driver: ${currentLoad.driver_name || "Unknown"}
                        <br>
                        Phone: ${currentLoad.driver_phone || "Unknown"}`).openPopup();
            }
        });
        driverMarkers[load.id] = marker;
    } else { driverMarkers[load.id].setLatLng([load.driver_lat, load.driver_lng]);}
}

function openDriverSheet(load) {
    selectedLoad = load;
    document.getElementById("sheet-payout").innerText = `$${Number(load.payout).toLocaleString()}`;
    document.getElementById("sheet-company").innerText = load.company_name;
    document.getElementById("sheet-cargo").innerText = `Active Load: ${load.cargo_description}`;
    document.getElementById("sheet-origin").innerText = load.origin_city;
    document.getElementById("sheet-dest").innerText = load.destination_city;
    const actionArea = document.getElementById("sheet-action-area");
    // when a load is bookd
    if (load.status === "booked") {
        actionArea.innerHTML = `
            <button
                id="pickup-btn"
                class="w-full bg-amber-600 hover:bg-amber-500 text-white font-bold py-3 rounded-xl transition text-md shadow-lg"
            >
                Picked Up Cargo
            </button>
        `;
        document.getElementById("pickup-btn").addEventListener("click", async () => {
            try {
                await api(`/loads/${load.id}/pickup`, {method: "POST"});
                sheet.classList.remove("active");
                logNotification(`Driver ${activeDriverName} picked up cargo. Routing to destination.`);
                await fetchAllLoads();
                } catch (error) {
                    alert(`Error: ${error.message}`);
                }
            }
        );
    }
    // logic for in transit
    else if (load.status === "in_transit") {
        actionArea.innerHTML = `
            <button
                id="driver-complete-btn"
                class="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 rounded-xl transition text-md shadow-lg"
            >
                Mark Delivery as Complete
            </button>
        `;
        document.getElementById("driver-complete-btn").addEventListener("click", async () => {
            try {
                await api(`/loads/${load.id}/complete`, {method: "POST"});
                sheet.classList.remove("active");
                logNotification(`Driver ${activeDriverName} marked delivery complete! Awaiting company sign-off.`);
                await fetchAllLoads();
                } catch (error) {
                    alert(`Error: ${error.message}`);
                }
            }
        );
    }
    // pending verfication system
    else if (load.status === "pending_verification") {
        actionArea.innerHTML = `
            <div class="text-slate-400 text-sm text-center py-2 italic">
                Delivery complete. Awaiting company confirmation.
            </div>
        `;
    }
    sheet.classList.add("active");
}

// draw load from data from graphhopper
function drawLoadOnMap(load) {
    // opening the load
    if (load.status === "open") {
        createOpenLoadMarker(load);
        return;
    }
    // active driver load
    if (["booked", "in_transit", "pending_verification"].includes(load.status)) {
        // remove pickup markrer
        if (markers[load.id]) {
            map.removeLayer(
                markers[load.id]
            );
            delete markers[load.id];
        }
        createOrUpdateDriverMarker(load);
        // go from driver to pick up
        if (load.status === "booked" && load.driver_lat != null && load.driver_lng != null) {
            drawRouteLine(load.id, load.driver_lat, load.driver_lng, load.lat_coords, load.lng_coords,"#f59e0b");
        }
        // go from driver to destinations
        else if (["in_transit","pending_verification"].includes(load.status) && load.driver_lat != null && load.driver_lng != null && load.dest_lat != null && load.dest_lng != null) {
            drawRouteLine(load.id, load.driver_lat, load.driver_lng, load.dest_lat, load.dest_lng, "#3b82f6");
        }
        return;
    }
    // marked deliver
    if (load.status === "delivered") {
        removeLoadMapObjects(load.id);
    }
}

// fetch loaded data from backend
async function fetchAllLoads() {
    try {
        const data = await api("/loads");
        allLoadedData = data.loads || [];
        allLoadedData.forEach(drawLoadOnMap);
        updateCompanyVerificationPanel(allLoadedData);
        checkSimulationCompletion() 
    } catch (error) {
        console.error("Failed to fetch loads:", error);
    }
}


// live update for location on routes for dispatcher
let lastLoadSnapshot = "";
async function startLiveMatrix() {
    await fetchAllLoads();
    setInterval(
        async () => {
            try {
                const data = await api("/loads");
                const loads = data.loads || [];
                const snapshot = JSON.stringify(loads);
                if (snapshot !== lastLoadSnapshot) {
                    lastLoadSnapshot = snapshot;
                    allLoadedData = loads;
                    allLoadedData.forEach(drawLoadOnMap);
                    updateCompanyVerificationPanel(allLoadedData);
                    checkSimulationCompletion();
                }
            } catch (error) {
                console.error("Live update error:",error);
            }
        },
        2000
    );
}

// driver acceptance logic and tracking
document.getElementById("driver-accept-form").addEventListener("submit", async e => {
    e.preventDefault();

    if (!selectedLoad) {return;}

    if (!navigator.geolocation) {
        alert("Geolocation not supported.");
        return;
    }
    const enteredDriverName = document.getElementById("driver-name").value.trim();
    activeDriverName = enteredDriverName;
    localStorage.setItem("empty_mile_driver_name", activeDriverName);
    activeDriverInput.value = activeDriverName;
    const btn = document.getElementById("confirm-accept-btn");
    btn.innerHTML = `<i data-lucide="loader-2" class="animate-spin w-5 h-5"></i> Acquiring GPS...`;
    lucide.createIcons();
    navigator.geolocation.getCurrentPosition(
        async pos => {
            const currentLat = pos.coords.latitude;
            const currentLng = pos.coords.longitude;
            try {
                await api(`/loads/${selectedLoad.id}/accept`, {
                    method: "POST",
                    body: JSON.stringify({
                        driver_name: enteredDriverName,
                        driver_phone: document.getElementById("driver-phone").value,
                        driver_email: document.getElementById("driver-email").value,
                        est_pickup: document.getElementById("est-pickup").value,
                        est_dropoff: document.getElementById("est-dropoff").value,
                        driver_lat: currentLat,
                        driver_lng: currentLng
                    })
                });
                document.getElementById("driver-accept-modal").classList.add("hidden");
                e.target.reset();
                logNotification(`Load accepted by driver ${enteredDriverName}. Live GPS active.`);
                if (activeWatchId !== null) {
                    navigator.geolocation.clearWatch(activeWatchId);
                }
                activeWatchId = navigator.geolocation.watchPosition(
                    async livePos => {
                        try {
                            await api(`/loads/${selectedLoad.id}/location`, {
                                method: "POST",
                                body:
                                JSON.stringify({
                                    lat:livePos.coords.latitude, 
                                    lng:livePos.coords.longitude
                                })
                            });
                        } catch (error) {
                            console.error("GPS update failed:", error);
                        }
                    },  err => {
                        console.error("WatchPosition error:", err);
                        if (err.code === err.PERMISSION_DENIED) {
                            alert("Location permission denied. Tracking stopped.");
                        }
                    }, {
                        enableHighAccuracy: true,
                        maximumAge: 10000,
                        timeout: 20000
                    });
                        await fetchAllLoads();
            } catch (error) {
                alert(`Error: ${error.message}`);
            } finally {
                btn.innerHTML = `<i data-lucide="check-circle" class="w-5 h-5"></i> Confirm & Enable GPS Stream`;
                lucide.createIcons();
            }
        }, () => {
            alert("GPS permission was denied or unavailable.");
            btn.innerHTML = `<i data-lucide="check-circle" class="w-5 h-5"></i> Confirm & Enable GPS Stream`;
            lucide.createIcons();
        }, {enableHighAccuracy: true});
});


// handle simulation

const simTestBtn = document.getElementById("sim-test-btn");
const simNextBtn = document.getElementById("sim-next-btn");
const simSpeedSlider = document.getElementById("sim-speed-slider");

let simBusy = false;
let simDriveTimeoutId = null;

let simState = {
    stage: null, // null | "open" | "in_transit"
    loadId: null,
    driverName: null,
    originLat: null,
    originLng: null,
    destLat: null,
    destLng: null
};

function resetSimState() {
    simState = {
        stage: null,
        loadId: null,
        driverName: null,
        destinationCity: null,
        originLat: null,
        originLng: null,
        destLat: null,
        destLng: null
    };
}


function updateSimButtons() {
    if (!simTestBtn || !simNextBtn) return;
    simTestBtn.disabled = simBusy || simState.stage !== null;
    simNextBtn.disabled = simBusy || simState.stage === null || simState.stage === "arrived";
    simTestBtn.classList.toggle("opacity-40", simTestBtn.disabled);
    simNextBtn.classList.toggle("opacity-40", simNextBtn.disabled);
    if (simBusy && simState.stage === "in_transit") {
        simNextBtn.innerHTML = `<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> Driving...`;
    } else if (simState.stage === "open") {
        simNextBtn.innerHTML = `<i data-lucide="skip-forward" class="w-4 h-4"></i> Next: Pickup`;
    } else if (simState.stage === "in_transit") {
        simNextBtn.innerHTML = `<i data-lucide="skip-forward" class="w-4 h-4"></i> Next: Deliver`;
    } else if (simState.stage === "arrived") {
        simNextBtn.innerHTML = `<i data-lucide="map-pin-check" class="w-4 h-4"></i> Awaiting Driver`;
    } else {
        simNextBtn.innerHTML = `<i data-lucide="skip-forward" class="w-4 h-4"></i> Next`;
    }
    lucide.createIcons();
}

// handle complete simulation 
function checkSimulationCompletion() {
    if (!simState.loadId) return;
    const simLoad = allLoadedData.find(l => l.id === simState.loadId);
    if (simLoad && simLoad.status === "delivered") {
        logNotification(`[TEST] Simulation complete — company confirmed delivery for ${simState.driverName}.`);
        resetSimState();
        updateSimButtons();
    }
}

/*
Router helpers
*/
function sampleCoordinates(coords, maxPoints) {
    if (coords.length <= maxPoints) {return coords;}
    const stride = (coords.length - 1) / (maxPoints - 1);
    const sampled = [];
    for (let i = 0; i < maxPoints; i++) {sampled.push(coords[Math.round(i * stride)]);}
    return sampled;
}

// account for graphhopper fallback, by routing using s straight line
function interpolatePoints(startLat, startLng, endLat, endLng, steps) {
    const points = [];
    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        points.push([startLat + (endLat - startLat) * t, startLng + (endLng - startLng) * t]);
    }
    return points;
}

// use data from graphhopper and drive
function driveAlongRoute(loadId, coords) {
    return new Promise(resolve => {
        let index = 0;
        function step() {
            if (index >= coords.length) {
                resolve();
                return;
            }
            const [lat, lng] = coords[index];
            if (driverMarkers[loadId]) {
                driverMarkers[loadId].setLatLng([lat, lng]);
            }
            api(`/loads/${loadId}/location`, {
                method: "POST",
                body: JSON.stringify({ lat, lng })
            }).catch(error => {
                console.error("Simulated GPS update failed:", error);
            });
            index++;
            const speedValue = simSpeedSlider ? parseInt(simSpeedSlider.value, 10) || 5 : 5;
            // slider to adjust mock speed
            const intervalMs = Math.max(40, 700 / speedValue);
            simDriveTimeoutId = setTimeout(step, intervalMs);
        }
        step();
    });
}

async function spawnTestLoad() {
    if (simBusy || simState.stage !== null) {return;}
    simBusy = true;
    updateSimButtons();
    try {
        const sample = await api("/simulation/random-load");
        const created =
            await api("/loads", {
                method: "POST",
                body: JSON.stringify({
                    company_name: sample.company_name,
                    payout: sample.payout,
                    cargo_description: sample.cargo_description,
                    origin_city: sample.origin_city,
                    destination_city: sample.destination_city
                })
            });
        const load = created.load;
        simState = {
            stage: "open",
            loadId: load.id,
            driverName: sample.driver_name,
            destinationCity: load.destination_city,
            originLat: load.lat_coords,
            originLng: load.lng_coords,
            destLat: load.dest_lat,
            destLng: load.dest_lng
        };
        logNotification(`[TEST] Spawned load: ${sample.cargo_description} for ${sample.company_name} (${sample.origin_city} → ${sample.destination_city}).`);
        await fetchAllLoads();
    } catch (error) {
        alert(`Simulation error: ${error.message}`);
    } finally {
        simBusy = false;
        updateSimButtons();
    }
}

async function advanceSimulation() {
    if (simBusy || simState.stage === null) {return;}
    simBusy = true;
    updateSimButtons();
    try {
        if (simState.stage === "open") {
            await api(`/loads/${simState.loadId}/accept`, {
                method: "POST",
                body: JSON.stringify({
                    driver_name: simState.driverName,
                    driver_phone: "N/A",
                    driver_email: "N/A",
                    est_pickup: "Simulated",
                    est_dropoff: "Simulated",
                    driver_lat: simState.originLat,
                    driver_lng: simState.originLng
                })
            });
            await api(`/loads/${simState.loadId}/pickup`, {method: "POST"});
            simState.stage = "in_transit";
            logNotification(`[TEST] Driver ${simState.driverName} picked up the load at the pickup point.`);
            await fetchAllLoads();
        } else if (simState.stage === "in_transit") {
            updateSimButtons();
            let coords = null;
            try {
                const routeData =
                    await api(
                        `/route?${new URLSearchParams({
                            start_lat: simState.originLat,
                            start_lng: simState.originLng,
                            end_lat: simState.destLat,
                            end_lng: simState.destLng
                        }).toString()}`
                    );
                if (routeData.coordinates && routeData.coordinates.length > 1) {
                    coords = sampleCoordinates(routeData.coordinates, 50);
                }
            } catch (error) {console.error("Simulated route lookup failed, falling back to a straight line:", error);}
            // If GraphHopper isn't configured or the lookup
            // failed, still drive - just in a straight line.
            if (!coords) {
                coords = interpolatePoints(simState.originLat, simState.originLng, simState.destLat, simState.destLng, 30);
            }
            logNotification(`[TEST] Driver ${simState.driverName} is en route to the destination...`);
            await driveAlongRoute(simState.loadId, coords);
            simState.stage = "arrived";
            currentRole = "driver";
            localStorage.setItem("empty_mile_role", "driver");
            activeDriverName = simState.driverName;
            localStorage.setItem("empty_mile_driver_name", activeDriverName);
            activeDriverInput.value = activeDriverName;
            updateRoleUI();
            logNotification(
                `[TEST] Load has arrived at ${simState.destinationCity || "the destination"}. Click the driver's marker to mark the delivery complete.`
            );
        }
        await fetchAllLoads();
    } catch (error) {
        alert(`Simulation error: ${error.message}`);
    } finally {
        simBusy = false;
        updateSimButtons();
    }
}
if (simTestBtn) {simTestBtn.addEventListener("click", spawnTestLoad);}
if (simNextBtn) {simNextBtn.addEventListener("click", advanceSimulation);}
updateSimButtons();


// Front end initiizations

renderNotifications();
document.getElementById("noti-badge").classList.toggle("hidden", getStoredNotis().length === 0);
startLiveMatrix();