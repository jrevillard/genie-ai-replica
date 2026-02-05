// ConnectivityService.swift
// Network monitoring service using NWPathMonitor

import Foundation
import Network
import Combine

@Observable
class ConnectivityService: @unchecked Sendable {
    private let monitor = NWPathMonitor()
    private let queue = DispatchQueue(label: "ConnectivityMonitor")

    private(set) var isNetworkAvailable = true
    var userOfflineOverride = false

    var isOnline: Bool {
        isNetworkAvailable && !userOfflineOverride
    }

    // Publisher for connectivity changes
    private let statusSubject = PassthroughSubject<Bool, Never>()
    var statusPublisher: AnyPublisher<Bool, Never> {
        statusSubject.eraseToAnyPublisher()
    }

    init() {
        startMonitoring()
    }

    deinit {
        stopMonitoring()
    }

    func startMonitoring() {
        print("[Connectivity] Starting network monitor...")

        monitor.pathUpdateHandler = { [weak self] path in
            Task { @MainActor in
                guard let self = self else { return }

                let wasAvailable = self.isNetworkAvailable
                self.isNetworkAvailable = path.status == .satisfied

                if wasAvailable != self.isNetworkAvailable {
                    print("[Connectivity] Network status changed: \(self.isNetworkAvailable ? "Online" : "Offline")")
                    self.emitStatus()
                }
            }
        }

        monitor.start(queue: queue)
    }

    func stopMonitoring() {
        print("[Connectivity] Stopping network monitor")
        monitor.cancel()
    }

    func toggleUserOfflineMode() -> Bool {
        print("[Connectivity] Toggling user offline mode. Current: \(userOfflineOverride)")
        userOfflineOverride.toggle()
        emitStatus()
        print("[Connectivity] User offline mode: \(userOfflineOverride)")
        return userOfflineOverride
    }

    func setUserOfflineMode(_ isOffline: Bool) {
        guard userOfflineOverride != isOffline else { return }
        print("[Connectivity] Setting user offline mode: \(isOffline)")
        userOfflineOverride = isOffline
        emitStatus()
    }

    func recheckConnectivity() async {
        // Force a check by creating a temporary path monitor
        let tempMonitor = NWPathMonitor()
        let tempQueue = DispatchQueue(label: "TempConnectivityCheck")

        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            tempMonitor.pathUpdateHandler = { [weak self] path in
                let isAvailable = path.status == .satisfied
                Task { @MainActor in
                    guard let self = self else {
                        tempMonitor.cancel()
                        continuation.resume()
                        return
                    }
                    self.isNetworkAvailable = isAvailable
                    self.emitStatus()
                    tempMonitor.cancel()
                    continuation.resume()
                }
            }
            tempMonitor.start(queue: tempQueue)
        }
    }

    private func emitStatus() {
        let status = isOnline
        print("[Connectivity] Emitting status: \(status) (Network: \(isNetworkAvailable), UserOverride: \(userOfflineOverride))")
        statusSubject.send(status)
    }
}
