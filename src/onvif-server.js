const soap = require("soap");
const http = require("node:http");
const dgram = require("node:dgram");
const xml2js = require("xml2js");
const uuid = require("uuid");
const url = require("node:url");
const fs = require("node:fs");
const logger = require("simple-node-logger");

const { getIp4FromMac } = require("./net-tools");

Date.prototype.stdTimezoneOffset = function () {
  const jan = new Date(this.getFullYear(), 0, 1);
  const jul = new Date(this.getFullYear(), 6, 1);
  return Math.max(jan.getTimezoneOffset(), jul.getTimezoneOffset());
};

Date.prototype.isDstObserved = function () {
  return this.getTimezoneOffset() < this.stdTimezoneOffset();
};

module.exports = class OnvifServer {
  constructor(logger, config) {
    this.config = config;
    this.logger = logger;

    this.config.hostname = getIp4FromMac(logger, this.config.mac);
    if (!this.config.hostname) {
      throw new Error("Could not obtain IP address");
    }

    this.videoSource = {
      attributes: {
        token: "video_src_token",
      },
      Framerate: this.config.highQuality.framerate,
      Resolution: {
        Width: this.config.highQuality.width,
        Height: this.config.highQuality.height,
      },
    };

    this.profiles = [
      {
        Name: "MainStream",
        attributes: {
          token: "main_stream",
        },
        VideoSourceConfiguration: {
          Name: "VideoSource",
          UseCount: 2,
          attributes: {
            token: "video_src_config_token",
          },
          SourceToken: "video_src_token_hq",
          Bounds: {
            attributes: {
              x: 0,
              y: 0,
              width: this.config.highQuality.width,
              height: this.config.highQuality.height,
            },
          },
        },
        VideoEncoderConfiguration: {
          attributes: {
            token: "encoder_hq_config_token",
          },
          Name: "CardinalHqCameraConfiguration",
          UseCount: 1,
          Encoding: "H264",
          Resolution: {
            Width: this.config.highQuality.width,
            Height: this.config.highQuality.height,
          },
          Quality: this.config.highQuality.quality,
          RateControl: {
            FrameRateLimit: this.config.highQuality.framerate,
            EncodingInterval: 10,
            BitrateLimit: this.config.highQuality.bitrate,
          },
          H264: {
            GovLength: this.config.highQuality.framerate,
            H264Profile: "Main",
          },
          SessionTimeout: "PT16H40M",
        },
      },
    ];

    if (this.config.lowQuality) {
      this.profiles.push({
        Name: "SubStream",
        attributes: {
          token: "sub_stream",
        },
        VideoSourceConfiguration: {
          Name: "VideoSource",
          UseCount: 2,
          attributes: {
            token: "video_src_config_token",
          },
          SourceToken: "video_src_token_lq",
          Bounds: {
            attributes: {
              x: 0,
              y: 0,
              width: this.config.highQuality.width,
              height: this.config.highQuality.height,
            },
          },
        },
        VideoEncoderConfiguration: {
          attributes: {
            token: "encoder_lq_config_token",
          },
          Name: "CardinalLqCameraConfiguration",
          UseCount: 1,
          Encoding: "H264",
          Resolution: {
            Width: this.config.lowQuality.width,
            Height: this.config.lowQuality.height,
          },
          Quality: this.config.lowQuality.quality,
          RateControl: {
            FrameRateLimit: this.config.lowQuality.framerate,
            EncodingInterval: 10,
            BitrateLimit: this.config.lowQuality.bitrate,
          },
          H264: {
            GovLength: this.config.lowQuality.framerate,
            H264Profile: "Main",
          },
          SessionTimeout: "PT16H40M",
        },
      });
    }

    this.onvif = {
      DeviceService: {
        Device: {
          GetSystemDateAndTime: (args) => {
            const now = new Date();

            // const offset = now.getTimezoneOffset();
            // const abs_offset = Math.abs(offset);
            // const hrs_offset = Math.floor(abs_offset / 60);
            // const mins_offset = abs_offset % 60;
            // const tz = `UTC${offset < 0 ? "-" : "+"}${hrs_offset}${mins_offset === 0 ? "" : `:${mins_offset}`}`;
            const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

            return {
              SystemDateAndTime: {
                DateTimeType: "NTP",
                DaylightSavings: now.isDstObserved(),
                TimeZone: {
                  TZ: tz,
                },
                UTCDateTime: {
                  Time: {
                    Hour: now.getUTCHours(),
                    Minute: now.getUTCMinutes(),
                    Second: now.getUTCSeconds(),
                  },
                  Date: {
                    Year: now.getUTCFullYear(),
                    Month: now.getUTCMonth() + 1,
                    Day: now.getUTCDate(),
                  },
                },
                LocalDateTime: {
                  Time: {
                    Hour: now.getHours(),
                    Minute: now.getMinutes(),
                    Second: now.getSeconds(),
                  },
                  Date: {
                    Year: now.getFullYear(),
                    Month: now.getMonth() + 1,
                    Day: now.getDate(),
                  },
                },
                Extension: {},
              },
            };
          },

          GetCapabilities: (args) => {
            const response = {
              Capabilities: {},
            };

            if (
              args.Category === undefined ||
              args.Category === null ||
              args.Category === "" ||
              args.Category === "All" ||
              args.Category === "Device"
            ) {
              response.Capabilities["Device"] = {
                XAddr: `http://${this.config.hostname}:${this.config.ports.server}/onvif/device_service`,
                Network: {
                  IPFilter: false,
                  ZeroConfiguration: false,
                  IPVersion6: false,
                  DynDNS: false,
                  Extension: {
                    Dot11Configuration: false,
                    Extension: {},
                  },
                },
                System: {
                  DiscoveryResolve: false,
                  DiscoveryBye: false,
                  RemoteDiscovery: false,
                  SystemBackup: false,
                  SystemLogging: false,
                  FirmwareUpgrade: false,
                  SupportedVersions: {
                    Major: 2,
                    Minor: 5,
                  },
                  Extension: {
                    HttpFirmwareUpgrade: false,
                    HttpSystemBackup: false,
                    HttpSystemLogging: false,
                    HttpSupportInformation: false,
                    Extension: {},
                  },
                },
                IO: {
                  InputConnectors: 0,
                  RelayOutputs: 1,
                  Extension: {
                    Auxiliary: false,
                    AuxiliaryCommands: "",
                    Extension: {},
                  },
                },
                Security: {
                  "TLS1.1": false,
                  "TLS1.2": false,
                  OnboardKeyGeneration: false,
                  AccessPolicyConfig: false,
                  "X.509Token": false,
                  SAMLToken: false,
                  KerberosToken: false,
                  RELToken: false,
                  Extension: {
                    "TLS1.0": false,
                    Extension: {
                      Dot1X: false,
                      RemoteUserHandling: false,
                    },
                  },
                },
                Extension: {},
              };
            }
            if (
              args.Category === undefined ||
              args.Category === null ||
              args.Category === "" ||
              args.Category === "All" ||
              args.Category === "Media"
            ) {
              response.Capabilities["Media"] = {
                XAddr: `http://${this.config.hostname}:${this.config.ports.server}/onvif/media_service`,
                StreamingCapabilities: {
                  RTPMulticast: false,
                  RTP_TCP: true,
                  RTP_RTSP_TCP: true,
                  Extension: {},
                },
                Extension: {
                  ProfileCapabilities: {
                    MaximumNumberOfProfiles: this.profiles.length,
                  },
                },
              };
            }

            return response;
          },

          GetServices: (args) => {
            return {
              Service: [
                {
                  Namespace: "http://www.onvif.org/ver10/device/wsdl/",
                  XAddr: `http://${this.config.hostname}:${this.config.ports.server}/onvif/device_service`,
                  Version: {
                    Major: 2,
                    Minor: 5,
                  },
                },
                {
                  Namespace: "http://www.onvif.org/ver10/media/wsdl/",
                  XAddr: `http://${this.config.hostname}:${this.config.ports.server}/onvif/media_service`,
                  Version: {
                    Major: 2,
                    Minor: 5,
                  },
                },
              ],
            };
          },

          GetDeviceInformation: (args) => {
            return {
              Manufacturer: "rtsp-2-onvif",
              Model: `${this.config.name}`,
              FirmwareVersion: "1.0.0",
              SerialNumber: `${this.config.name.replace(" ", "_")}-0000`,
              HardwareId: `${this.config.name.replace(" ", "_")}-1001`,
            };
          },
        },
      },

      MediaService: {
        Media: {
          GetProfiles: (args) => {
            return {
              Profiles: this.profiles,
            };
          },

          GetVideoSources: (args) => {
            this.logger.debug(
              `Entering GetVideoSources with args: ${JSON.stringify(args)}`,
            );
            const response = {
              VideoSources: [this.videoSource],
            };
            this.logger.debug(
              `GetVideoSources response: ${JSON.stringify(response)}`,
            );
            return response;
          },

          GetSnapshotUri: (args) => {
            let uri = `http://${this.config.hostname}:${this.config.ports.server}/snapshot.png`;
            if (
              args.ProfileToken === "sub_stream" &&
              this.config.lowQuality &&
              this.config.lowQuality.snapshot
            )
              uri = `http://${this.config.hostname}:${this.config.ports.snapshot}${this.config.lowQuality.snapshot}`;
            else if (this.config.highQuality.snapshot)
              uri = `http://${this.config.hostname}:${this.config.ports.snapshot}${this.config.highQuality.snapshot}`;

            return {
              MediaUri: {
                Uri: uri,
                InvalidAfterConnect: false,
                InvalidAfterReboot: false,
                Timeout: "PT30S",
              },
            };
          },

          GetStreamUri: (args) => {
            try {
              let path = this.config.highQuality.rtsp;
              if (args.ProfileToken === "sub_stream" && this.config.lowQuality)
                path = this.config.lowQuality.rtsp;

              this.logger.debug(`GetStreamUri para path: ${path}`);

              return {
                MediaUri: {
                  Uri: `rtsp://${this.config.hostname}:${this.config.ports.rtsp}${path}`,
                  InvalidAfterConnect: false,
                  InvalidAfterReboot: false,
                  Timeout: "PT30S",
                },
              };
            } catch (error) {
              this.logger.error(`Error en GetStreamUri: ${error.message}`);
              return {
                MediaUri: {
                  Uri: "",
                  InvalidAfterConnect: true,
                  InvalidAfterReboot: true,
                  Timeout: "PT30S",
                },
              };
            }
          },
        },
      },
    };

    // Add log entry when starting the ONVIF server
    this.logger.info(
      `ONVIF Server started for ${this.config.name} on ${this.config.hostname}:${this.config.ports.server}`,
    );
  }

  startHttpServer() {
    this.logger.info(
      `SERVER: ${this.config.name} - HTTP listening on ${this.config.hostname}:${this.config.ports.server}`,
    );

    this.server = http.createServer();

    // Handle snapshot requests directly
    this.server.on("request", (request, response) => {
      const action = url.parse(request.url, true).pathname;

      if (action === "/snapshot.png") {
        try {
          const image = fs.readFileSync("./resources/snapshot.png");
          response.writeHead(200, { "Content-Type": "image/png" });
          response.end(image, "binary");
          this.logger.info(`Snapshot served for ${this.config.name}`);
        } catch (error) {
          this.logger.error(`Error serving snapshot: ${error.message}`);
          response.writeHead(404, { "Content-Type": "text/plain" });
          response.end("Snapshot not found");
        }
      }
    });

    // Add error handler for the HTTP server
    this.server.on("error", (err) => {
      this.logger.error(
        `SERVER: ${this.config.name} - HTTP Server Error: ${err.message}`,
      );
      this.restartServer();
    });

    // Add handler for the 'close' event of the HTTP server
    this.server.on("close", () => {
      this.logger.warn(`SERVER: ${this.config.name} - HTTP Server closed`);
      this.restartServer();
    });

    this.server.listen(this.config.ports.server, this.config.hostname);

    this.deviceService = soap.listen(this.server, {
      path: "/onvif/device_service",
      services: this.onvif,
      // xml: fs.readFileSync("./wsdl/device_service.wsdl", "utf8"),
      xml: `<?xml version="1.0" encoding="utf-8" ?>Add commentMore actions
                    <wsdl:definitions xmlns:s="http://www.w3.org/2001/XMLSchema" xmlns:i0="http://www.onvif.org/ver10/device/wsdl" xmlns:soap12="http://schemas.xmlsoap.org/wsdl/soap12/" xmlns:http="http://schemas.xmlsoap.org/wsdl/http/" xmlns:mime="http://schemas.xmlsoap.org/wsdl/mime/" xmlns:tns="http://tempuri.org/" xmlns:soap="http://schemas.xmlsoap.org/wsdl/soap/" xmlns:tm="http://microsoft.com/wsdl/mime/textMatching/" xmlns:soapenc="http://schemas.xmlsoap.org/soap/encoding/" xmlns:wsdl="http://schemas.xmlsoap.org/wsdl/" targetNamespace="http://tempuri.org/">
                      <wsdl:import namespace="http://www.onvif.org/ver10/device/wsdl" location="https://www.onvif.org/ver10/device/wsdl/devicemgmt.wsdl"/>
                      <wsdl:service name="DeviceService">
                        <wsdl:port name="Device" binding="i0:DeviceBinding">
                          <soap:address location="http://${this.config.hostname}:${this.config.ports.server}/onvif/device_service"/>
                        </wsdl:port>
                      </wsdl:service>
                    </wsdl:definitions>`,
      forceSoap12Headers: true,
    });

    // Add error handler for the device SOAP service
    this.deviceService.on("error", (err) => {
      this.logger.error(
        `SERVER: ${this.config.name} - DeviceService Error: ${err.message}`,
      );
      this.restartServer();
    });

    // Add handler for the 'close' event of the device SOAP service
    this.deviceService.on("close", () => {
      this.logger.warn(`SERVER: ${this.config.name} - DeviceService closed`);
      this.restartServer();
    });

    this.deviceService.on("connection", (socket) => {
      this.logger.info(
        `Device connected: ${socket.remoteAddress}:${socket.remotePort}`,
      );
    });

    this.deviceService.on("close", () => {
      this.logger.warn(`Device disconnected: ${this.config.name}`);
    });

    this.mediaService = soap.listen(this.server, {
      path: "/onvif/media_service",
      services: this.onvif,
      // xml: fs.readFileSync("./wsdl/media_service.wsdl", "utf8"),
      xml: `<?xml version="1.0" encoding="utf-8" ?>Add commentMore actions
                    <wsdl:definitions xmlns:s="http://www.w3.org/2001/XMLSchema" xmlns:i0="http://www.onvif.org/ver10/device/wsdl" xmlns:soap12="http://schemas.xmlsoap.org/wsdl/soap12/" xmlns:http="http://schemas.xmlsoap.org/wsdl/http/" xmlns:mime="http://schemas.xmlsoap.org/wsdl/mime/" xmlns:tns="http://tempuri.org/" xmlns:soap="http://schemas.xmlsoap.org/wsdl/soap/" xmlns:tm="http://microsoft.com/wsdl/mime/textMatching/" xmlns:soapenc="http://schemas.xmlsoap.org/soap/encoding/" xmlns:wsdl="http://schemas.xmlsoap.org/wsdl/" targetNamespace="http://tempuri.org/">
                      <wsdl:import namespace="http://www.onvif.org/ver10/media/wsdl" location="https://www.onvif.org/ver10/media/wsdl/media.wsdl"/>
                      <wsdl:service name="MediaService">
                        <wsdl:port name="Media" binding="i0:MediaBinding">
                          <soap:address location="http://${this.config.hostname}:${this.config.ports.server}/onvif/media_service" />
                        </wsdl:port>
                      </wsdl:service>
                    </wsdl:definitions>`,
      forceSoap12Headers: true,
    });

    // Add error handler for the media SOAP service
    this.mediaService.on("error", (err) => {
      this.logger.error(
        `SERVER: ${this.config.name} - MediaService Error: ${err.message}`,
      );
      this.restartServer();
    });

    // Add handler for the 'close' event of the media SOAP service
    this.mediaService.on("close", () => {
      this.logger.warn(`SERVER: ${this.config.name} - MediaService closed`);
      this.restartServer();
    });

    this.mediaService.on("connection", (socket) => {
      this.logger.info(
        `Media connected: ${socket.remoteAddress}:${socket.remotePort}`,
      );
    });

    this.mediaService.on("close", () => {
      this.logger.warn(`Media disconnected: ${this.config.name}`);
    });

    this.mediaService.on("request", (request, methodName) => {
      this.logger.debug(
        `SERVER: ${this.config.name} -  MediaService: ${methodName}`,
      );
    });
  }

  restartServer() {
    this.logger.info(
      `SERVER: ${this.config.name} - Attempting to restart server in 5 seconds...`,
    );
    setTimeout(() => {
      this.startHttpServer();
    }, 5000);
  }

  enableDebugOutput() {
    this.deviceService.log = (type, data, req) => {
      console.debug(`SERVER: ${data}`);
      //there is no logger in this context
    };
    this.mediaService.log = (type, data, req) => {
      console.debug(`SERVER: ${data}`);
      //there is no logger in this context
    };
    this.deviceService.on("request", (request, methodName) => {
      this.logger.debug(
        `SERVER: ${this.config.name} - DeviceService: ${methodName}`,
      );
    });

    this.mediaService.on("request", (request, methodName) => {
      this.logger.debug(
        `SERVER: ${this.config.name} -  MediaService: ${methodName}`,
      );
    });
  }

  startDiscovery() {
    this.discoveryMessageNo = 0;
    this.discoverySocket = dgram.createSocket({
      type: "udp4",
      reuseAddr: true,
    });

    this.discoverySocket.on("message", (message, remote) => {
      this.logger.debug(
        `SERVER: ${this.config.name} - Discovery request from ${remote.address}:${remote.port}`,
      );

      xml2js.parseString(
        message.toString(),
        { tagNameProcessors: [xml2js["processors"].stripPrefix] },
        (err, result) => {
          const probeUuid = result["Envelope"]["Header"][0]["MessageID"][0];
          let probeType = "";
          try {
            probeType = result["Envelope"]["Body"][0]["Probe"][0]["Types"][0];
          } catch (err) {
            probeType = "";
          }

          if (typeof probeType === "object") probeType = probeType._;

          if (
            probeType === "" ||
            probeType.indexOf("NetworkVideoTransmitter") > -1
          ) {
            const response = `<?xml version="1.0" encoding="UTF-8"?>
                        <SOAP-ENV:Envelope xmlns:SOAP-ENV="http://www.w3.org/2003/05/soap-envelope" xmlns:wsa="http://schemas.xmlsoap.org/ws/2004/08/addressing" xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery" xmlns:dn="http://www.onvif.org/ver10/network/wsdl">
                            <SOAP-ENV:Header>
                                <wsa:MessageID>uuid:${uuid.v1()}</wsa:MessageID>
                                <wsa:RelatesTo>${probeUuid}</wsa:RelatesTo>
                                <wsa:To SOAP-ENV:mustUnderstand="true">http://schemas.xmlsoap.org/ws/2004/08/addressing/role/anonymous</wsa:To>
                                <wsa:Action SOAP-ENV:mustUnderstand="true">http://schemas.xmlsoap.org/ws/2005/04/discovery/ProbeMatches</wsa:Action>
                                <d:AppSequence SOAP-ENV:mustUnderstand="true" MessageNumber="${this.discoveryMessageNo}" InstanceId="1234567890"/>
                            </SOAP-ENV:Header>
                            <SOAP-ENV:Body>
                                <d:ProbeMatches>
                                    <d:ProbeMatch>
                                        <wsa:EndpointReference>
                                            <wsa:Address>urn:uuid:${this.config.uuid}</wsa:Address>
                                        </wsa:EndpointReference>
                                        <d:Types>dn:NetworkVideoTransmitter</d:Types>
                                        <d:Scopes>
                                            onvif://www.onvif.org/type/video_encoder
                                            onvif://www.onvif.org/type/ptz
                                            onvif://www.onvif.org/hardware/onvif
                                            onvif://www.onvif.org/name/${this.config.name} onvif://www.onvif.org/location/
                                        </d:Scopes>
                                        <d:XAddrs>http://${this.config.hostname}:${this.config.ports.server}/onvif/device_service</d:XAddrs>
                                        <d:MetadataVersion>1</d:MetadataVersion>
                                    </d:ProbeMatch>
                                </d:ProbeMatches>
                            </SOAP-ENV:Body>
                        </SOAP-ENV:Envelope>`;

            this.discoveryMessageNo++;
            const responseBuffer = Buffer.from(response);

            // Usar el socket existente para enviar la respuesta
            return this.discoverySocket.send(
              responseBuffer,
              0,
              responseBuffer.length,
              remote.port,
              remote.address,
            );
          }
        },
      );
    });

    // Add error handler for the discovery socket
    this.discoverySocket.on("error", (err) => {
      this.logger.error(
        `SERVER: ${this.config.name} - Discovery Socket Error: ${err.message}`,
      );
      this.discoverySocket.close();
      this.restartDiscovery();
    });

    this.discoverySocket.bind(3702, () => {
      return this.discoverySocket.addMembership(
        "239.255.255.250",
        this.config.hostname,
      );
    });

    // Add handler for the 'close' event of the discovery socket
    this.discoverySocket.on("close", () => {
      this.logger.warn(`SERVER: ${this.config.name} - Discovery Socket closed`);
      this.restartDiscovery();
    });
  }

  restartDiscovery() {
    this.logger.info(
      `SERVER: ${this.config.name} - Attempting to restart discovery in 5 seconds...`,
    );
    setTimeout(() => {
      this.startDiscovery();
    }, 5000);
  }

  getHostname() {
    return this.config.hostname;
  }
};
