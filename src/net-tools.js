const os = require("node:os");

function getIp4FromMac(logger, macAddress) {
  const networkInterfaces = os.networkInterfaces();

  for (const networkInterface in networkInterfaces) {
    logger.trace(networkInterface);
    for (const network of networkInterfaces[networkInterface]) {
      logger.trace(network);
      if (
        network.family === "IPv4" &&
        network.mac.toLowerCase() === macAddress.toLowerCase()
      ) {
        logger.debug(
          `NET_SCAN: Found ${network.address} on ${networkInterface} for MAC ${macAddress.toLowerCase()}`,
        );
        return network.address;
      }
    }
  }
  logger.error(`NET_SCAN: No interface with MAC ${macAddress.toLowerCase()}`);
  return null;
}

//Prefix - Unicast LAA
function generateNetworkMac() {
  return "1A:11:B0:XX:XX:XX".replace(/X/g, () =>
    "13579BDF".charAt(Math.floor(Math.random() * 8)),
  );
}

module.exports = {
  getIp4FromMac,
  generateNetworkMac,
};
