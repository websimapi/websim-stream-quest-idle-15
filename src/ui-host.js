// Host-only UI logic split out of UIManager

import { replaceAllPlayers } from './db.js';

export function setupHostUI(uiManager) {
    const {
        network,
        hostUserMenu,
        hostUserBtn,
        hostUserDropdown,
        realtimeUsersList,
        twitchUsersList,
        exportDataBtn,
        importDataBtn,
        importDataInput
    } = uiManager;

    // Show host user menu
    if (hostUserMenu) {
        hostUserMenu.style.display = 'flex';
    }

    // Helper: when a host clicks a user, show their profile (skills/inventory) in the main UI
    const onViewPlayer = (player) => {
        if (!player) return;
        if (typeof uiManager.showPlayerProfile === 'function') {
            uiManager.showPlayerProfile(player);
        }
    };

    // Host dropdown interactions
    if (hostUserBtn && hostUserDropdown) {
        hostUserBtn.addEventListener('click', () => {
            const isOpen = hostUserDropdown.style.display === 'block';
            hostUserDropdown.style.display = isOpen ? 'none' : 'block';
        });

        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!hostUserMenu) return;
            if (!hostUserMenu.contains(e.target)) {
                hostUserDropdown.style.display = 'none';
            }
        });
    }

    // Host export/import data controls
    if (exportDataBtn) {
        exportDataBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            try {
                const players = await network.exportChannelData();
                const blob = new Blob([JSON.stringify(players, null, 2)], {
                    type: 'application/json'
                });

                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                const channel = localStorage.getItem('sq_host_channel') || 'channel';
                const date = new Date().toISOString().replace(/[:.]/g, '-');
                a.href = url;
                a.download = `streamquest_${channel}_players_${date}.json`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            } catch (err) {
                console.error('Export failed', err);
            }
        });
    }

    if (importDataBtn && importDataInput) {
        importDataBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            importDataInput.click();
        });

        importDataInput.addEventListener('change', async (e) => {
            e.stopPropagation();
            const file = e.target.files && e.target.files[0];
            if (!file) return;

            const confirmOverride = window.confirm(
                'Importing will OVERWRITE all existing player data for this channel. Continue?'
            );
            if (!confirmOverride) {
                importDataInput.value = '';
                return;
            }

            try {
                const text = await file.text();
                const parsed = JSON.parse(text);

                if (!Array.isArray(parsed)) {
                    alert('Invalid import file: expected an array of players.');
                    importDataInput.value = '';
                    return;
                }

                await network.importChannelData(parsed, replaceAllPlayers);
                alert('Import complete. Player data has been replaced for this channel.');
            } catch (err) {
                console.error('Import failed', err);
                alert('Import failed. Check the console for details.');
            } finally {
                importDataInput.value = '';
            }
        });
    }

    // Track latest players list on the network manager so we can correlate peers <-> players
    network.lastPlayers = network.lastPlayers || [];

    // Hook host-specific callbacks
    network.onPresenceUpdate = (peers) => {
        // Re-render realtime users whenever presence changes, using the last known players list
        renderRealtimeUsers(peers, realtimeUsersList, onViewPlayer, network.lastPlayers);
    };

    network.onPlayerListUpdate = (players, peers) => {
        // Cache players for use in presence updates and realtime/twitch rendering
        network.lastPlayers = Array.isArray(players) ? players : [];

        renderTwitchUsers(players, peers, twitchUsersList, onViewPlayer, uiManager.hostSelfPlayer);
        renderRealtimeUsers(
            Object.entries(peers || {}).map(([id, info]) => ({
                id,
                username: info.username
            })),
            realtimeUsersList,
            onViewPlayer,
            network.lastPlayers
        );
    };
}

export function renderRealtimeUsers(peers, listEl, onViewPlayer, players) {
    if (!listEl) return;
    listEl.innerHTML = '';
    const allPlayers = Array.isArray(players) ? players : [];

    peers.forEach(peer => {
        const li = document.createElement('li');

        // Find if this realtime WebSim user is linked to a Twitch player profile
        const linkedPlayer = allPlayers.find(p => p.linkedWebsimId === peer.id);

        if (linkedPlayer) {
            // Linked realtime user: show "WebSim ↔ Twitch" and make clickable
            li.classList.add('linked-profile', 'clickable');
            li.innerHTML = `
                <span class="user-name">${peer.username}</span>
                <span class="user-meta">(linked ↔ ${linkedPlayer.username})</span>
            `;
            if (typeof onViewPlayer === 'function') {
                li.addEventListener('click', () => onViewPlayer(linkedPlayer));
            }
        } else {
            // Unlinked realtime user: WebSim username only, grey, not clickable (no profile)
            li.classList.add('unlinked-no-profile');
            li.innerHTML = `
                <span class="user-name">${peer.username}</span>
                <span class="user-meta">(no profile)</span>
            `;
        }

        listEl.appendChild(li);
    });
}

export function renderTwitchUsers(players, peers, listEl, onViewPlayer, hostSelfPlayer) {
    if (!listEl) return;
    listEl.innerHTML = '';
    const peersMap = peers || {};

    // If the host has a linked Twitch profile, provide a quick "View My Profile" entry
    if (hostSelfPlayer) {
        const selfLi = document.createElement('li');
        selfLi.classList.add('twitch-user-item', 'clickable');
        selfLi.innerHTML = `
            <span class="user-name">You: ${hostSelfPlayer.username}</span>
            <span class="user-meta">(your profile)</span>
        `;
        if (typeof onViewPlayer === 'function') {
            selfLi.addEventListener('click', () => onViewPlayer(hostSelfPlayer));
        }
        listEl.appendChild(selfLi);

        // Divider-style spacer between "you" and the rest of the list
        const divider = document.createElement('li');
        divider.style.borderTop = '1px solid var(--border)';
        divider.style.margin = '4px 0';
        listEl.appendChild(divider);
    }

    (players || []).forEach(player => {
        const li = document.createElement('li');
        const isLinked = !!player.linkedWebsimId && !!peersMap[player.linkedWebsimId];

        li.classList.add('twitch-user-item', 'clickable');

        let linkedLabel = '';
        if (isLinked) {
            const peerInfo = peersMap[player.linkedWebsimId];
            const websimName = peerInfo?.username || player.linkedWebsimId;
            linkedLabel = `(linked ↔ ${websimName})`;
        } else {
            // Unlinked Twitch users still have a profile and are playing
            linkedLabel = '(unlinked)';
        }

        li.innerHTML = `
            <span class="user-name">${player.username}</span>
            <span class="user-meta">${linkedLabel}</span>
        `;

        if (typeof onViewPlayer === 'function') {
            li.addEventListener('click', () => onViewPlayer(player));
        }

        listEl.appendChild(li);
    });
}