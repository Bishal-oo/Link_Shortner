import "express";                     // ensure Express's types are loaded + mark this file a module
declare global {                      // reach into the global type scope
  namespace Express {                 // Express declares its types inside a global `Express` namespace
    interface Request {               // re-open the EXISTING Request interface...
      user?: { id: string };          // ...and ADD a field to it
    }
  }
}
export {};                            // makes the file a module (required for `declare global`)