const { WebSocketServer } = require('ws')

let drivers = {}
let clients = new Map()

const port = process.env.PORT || 8080;

const wss = new WebSocketServer({ port })


wss.on("connection", (ws) => {
    ws.on("message", (message) => {
        try {
            const data = JSON.parse(message.toString())
            if (!data || typeof data !== 'object') return


            console.log(`📩 Received message`, data)

            // Register the client (rider or customer)
            if (data.type === 'register' && data.role && data.id) {
                // Remove existing client with same id
                for (let [sock, info] of clients.entries()) {
                    if (info.id === data.id && info.role === data.role) {
                        clients.delete(sock)
                        sock.close()
                        console.log(`⚠️ Duplicate connection removed for ${info.role} - ${info.id}`)
                    }
                }

                clients.set(ws, { role: data.role, id: data.id })
                console.log(`✅ Registered ${data.role} - ${data.id}`)
                return;
            }

            // Update rider location
            if (data.type === "riderLocationUpdate" && data.role === 'rider') {
                drivers[data.driverId] = {
                    latitude: data.location.latitude,
                    longitude: data.location.longitude,
                    address: data.location.address
                }

                clients.forEach((clientInfo, clientWs) => {
                    if (ws !== clientWs && clientInfo.role === 'customer') {
                        clientWs.send(JSON.stringify({
                            type: 'riderLocationUpdated',
                            driverId: data.driverId,
                            latitude: data.location.latitude,
                            longitude: data.location.longitude,
                            address: data.location.address
                        }))
                    }
                });
            }

            // Get driver location request
            if (data.type === "getDriverLocation" && data.role === 'customer') {
                const driverData = drivers[data.driverId]
                if (driverData) {
                    ws.send(JSON.stringify({
                        type: 'driverLocationResponse',
                        driverId: data.driverId,
                        location: driverData
                    }))
                } else {
                    ws.send(JSON.stringify({
                        type: 'driverNotFound',
                        message: `Driver with ID ${data.driverId} not found.`
                    }))
                }
            }

            // Rider logs out or goes off duty
            if (data.type === 'riderLogout' && data.role === 'rider') {
                delete drivers[data.driverId]

                for (let [clientWs, clientInfo] of clients.entries()) {
                    if (clientInfo.id === data.driverId && clientInfo.role === 'rider') {
                        clients.delete(clientWs)
                        clientWs.close()
                    }
                }

                clients.forEach((clientInfo, clientWs) => {
                    if (clientInfo.role === 'customer') {
                        clientWs.send(JSON.stringify({
                            type: 'driverOffline',
                            driverId: data.driverId
                        }))
                    }
                })
            }


            if (data.type === 'offDuty' && data.role === 'rider') {
                delete drivers[data.driverId]

                clients.forEach((clientInfo, clientWs) => {
                    if (clientInfo.role === 'customer') {
                        clientWs.send(JSON.stringify({
                            type: 'driverOffline',
                            driverId: data.driverId
                        }))
                    }
                })
            }


            if (data.type === 'onDuty' && data.role === 'rider') {
                // for (let [sock, info] of drivers.entries()) {
                //     if (info.id === data.driverId && info.role === data.role) {
                //         drivers.delete(sock)
                //         sock.close()
                //         console.log(`⚠️ Duplicate connection removed for ${info.role} - ${info.id}`)
                //     }
                // }

                for (let sock in drivers) {
                    const info = drivers[sock]
                    if (info.id === data.driverId && info.role === data.role) {
                        delete drivers[sock]
                        // You’ll need to figure out how to close the corresponding WebSocket
                        console.log(`⚠️ Duplicate connection removed for ${info.role} - ${info.id}`)
                    }
                }

                drivers.set(ws, { role: data.role, id: data.driverId })
                console.log(`✅ On Duty ${data.role} - ${data.driverId}`)

                clients.forEach((clientInfo, clientWs) => {
                    if (clientInfo.role === 'customer') {
                        clientWs.send(JSON.stringify({
                            type: 'driverOnDuty',
                            id: data.driverId
                        }))
                    }
                })
            }


            // Customer logout
            if (data.type === 'customerLogout' && data.role === 'customer') {
                delete drivers[data.driverId]
                for (let [clientWs, clientInfo] of clients.entries()) {
                    if (clientInfo.id === data.id && clientInfo.role === 'customer') {
                        clients.delete(clientWs)
                        clientWs.close()
                    }
                }
            }

            // Ride offer from customer to rider
            if (data.type === 'rideOffer' &&
                data.role === 'customer' &&
                data.rideDetails &&
                data.rideDetails.status === 'offer') {

                console.log("🧭 Entered rideOffer handling block")
                const targetDriverId = data.rideDetails.rider_id
                let driverSocket = null

                for (let [clientWs, clientInfo] of clients.entries()) {
                    if (clientInfo.role === 'rider' && clientInfo.id === targetDriverId) {
                        driverSocket = clientWs
                        break
                    }
                }

                if (driverSocket) {
                    driverSocket.send(JSON.stringify({
                        type: 'newRideOffer',
                        rideDetails: data.rideDetails
                    }))
                    console.log(`🚗 Ride offer sent to driver ${targetDriverId}`)
                } else {
                    console.log(`⚠️ Driver with ID ${targetDriverId} not connected`)
                    console.log("🔍 Current connected clients:")
                    clients.forEach((info) => {
                        console.log(`• ${info.role}: ${info.id}`)
                    })
                    ws.send(JSON.stringify({
                        status: 'error'
                    }))
                }
            }

            if (data.type === 'rejectRideOffer' && data.role === 'rider') {
                const targetCustomerId = data.customer_id
                let customerSocket = null

                for (let [clientWs, clientInfo] of clients.entries()) {
                    if (clientInfo.role === 'customer' && clientInfo.id === targetCustomerId) {
                        customerSocket = clientWs
                        break
                    }
                }

                if (customerSocket) {
                    customerSocket.send(JSON.stringify({
                        type: 'rideOfferRejected',
                        id: data.id
                    }))
                    console.log(`🚗 accepted ride offer of ${targetCustomerId}`)
                }
            }

            if (data.type === 'acceptRideOffer' && data.role === 'rider') {
                console.log('ride offer accepted')
                const targetCustomerId = data.customer_id
                let customerSocket = null

                for (let [clientWs, clientInfo] of clients.entries()) {
                    console.log(clientInfo)
                    if (clientInfo.role === 'customer' && clientInfo.id === targetCustomerId) {
                        customerSocket = clientWs
                        break
                    }
                }

                if (customerSocket) {
                    console.log('sending the accepted response to customer')
                    customerSocket.send(JSON.stringify({
                        type: 'rideofferAccepted',
                        id: data.id
                    }))
                } else {
                    console.log('no customer to accept the ride offer')
                }
            }

            if (data.type === 'reached' && data.role === 'rider') {
                const targetCustomerId = data.customer_id
                let customerSocket = null

                for (let [clientWs, clientInfo] of clients.entries()) {
                    console.log(clientInfo)
                    if (clientInfo.role === 'customer' && clientInfo.id === targetCustomerId) {
                        customerSocket = clientWs
                        break
                    }
                }

                if (customerSocket) {
                    customerSocket.send(JSON.stringify({
                        type: 'driverReached',
                        id: data.id
                    }))
                }
            }

            if (data.type === 'providingOTP' && data.role === 'customer') {
                console.log('sebnding the otp to rider')
                console.log(data)
                const targetDriverId = data.driver_id
                let driverSocket = null

                for (let [clientWs, clientInfo] of clients.entries()) {
                    if (clientInfo.role === 'rider' && clientInfo.id === targetDriverId) {
                        driverSocket = clientWs
                        break
                    }
                }

                if (driverSocket) {
                    driverSocket.send(JSON.stringify({
                        type: 'OTP',
                        otp: data.otp,
                        id: data.id
                    }))
                }
            }

            if (data.type === 'journeyBegins' && data.role === 'rider') {
                //after checking the otp
                const targetCustomerId = data.customer_id
                let customerSocket = null

                for (let [clientWs, clientInfo] of clients.entries()) {
                    if (clientInfo.role === 'customer' && clientInfo.id === targetCustomerId) {
                        customerSocket = clientWs
                        break
                    }
                }

                if (customerSocket) {
                    customerSocket.send(JSON.stringify({
                        type: 'rideBegins',
                        id: data.id
                    }))
                }
            }

            if (data.type === 'journeyEnds' && data.role === 'rider') {
                const targetCustomerId = data.customer_id
                let customerSocket = null

                for (let [clientWs, clientInfo] of clients.entries()) {
                    if (clientInfo.role === 'customer' && clientInfo.id === targetCustomerId) {
                        customerSocket = clientWs
                        break
                    }
                }

                if (customerSocket) {
                    customerSocket.send(JSON.stringify({
                        type: 'rideEnded',
                        id: data.id
                    }))
                }
            }
        } catch (error) {
            console.error("❌ Error handling message:", error)
        }
    })

    // CLEANUP on disconnect
    ws.on("close", () => {
        const clientInfo = clients.get(ws)
        if (clientInfo) {
            console.log(`❌ Disconnected: ${clientInfo.role} - ${clientInfo.id}`)
            clients.delete(ws)

            if (clientInfo.role === 'rider') {
                delete drivers[clientInfo.id]

                clients.forEach((info, clientWs) => {
                    if (info.role === 'customer') {
                        clientWs.send(JSON.stringify({
                            type: 'driverOffline',
                            driverId: clientInfo.id
                        }))
                    }
                })
            }
        }
    })
})
