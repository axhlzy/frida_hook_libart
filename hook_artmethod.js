
let artMethodAddress = null
let methodsArray = new Array()
let linesMap = new Map()
var maxTimes = 10
const STD_STRING_SIZE = 3 * Process.pointerSize

setImmediate(main)
function main() {
    hook_dlopen("libart.so", hook_native)
    hook_native()
}

var p = filter => printNames(filter)

class StdString {
    constructor() {
        this.handle = Memory.alloc(STD_STRING_SIZE)
    }

    dispose() {
        const [data, isTiny] = this._getData()
        if (!isTiny) {
            Java.api.$delete(data)
        }
    }

    disposeToString() {
        const result = this.toString()
        this.dispose()
        return result
    }

    toString() {
        const [data] = this._getData()
        return data.readUtf8String()
    }

    _getData() {
        const str = this.handle
        const isTiny = (str.readU8() & 1) === 0
        const data = isTiny ? str.add(1) : str.add(2 * Process.pointerSize).readPointer()
        return [data, isTiny]
    }
}

let prettyMethod = (method_id, withSignature) => {
    const result = new StdString()
    Java.api['art::ArtMethod::PrettyMethod'](result, method_id, withSignature ? 1 : 0)
    return result.disposeToString()
}

let hook_dlopen = (module_name, fun) => {
    let android_dlopen_ext = Module.findExportByName(null, "android_dlopen_ext")

    if (android_dlopen_ext) {
        Interceptor.attach(android_dlopen_ext, {
            onEnter: function (args) {
                let pathptr = args[0]
                if (pathptr) {
                    this.path = (pathptr).readCString()
                    if (this.path.indexOf(module_name) >= 0) {
                        this.canhook = true
                        // LOGE("android_dlopen_ext:", this.path)
                    }
                }
            },
            onLeave: function () {
                if (this.canhook) fun()
            }
        })
    }
    let dlopen = Module.findExportByName(null, "dlopen")
    if (dlopen) {
        Interceptor.attach(dlopen, {
            onEnter: function (args) {
                let pathptr = args[0]
                if (pathptr) {
                    this.path = (pathptr).readCString()
                    if (this.path.indexOf(module_name) >= 0) {
                        this.canhook = true
                        // LOGE("dlopen:", this.path)
                    }
                }
            },
            onLeave: function (retval) {
                if (this.canhook) {
                    fun()
                }
            }
        })
    }
    // LOGE("android_dlopen_ext:", android_dlopen_ext, "dlopen:", dlopen)
}

let hook_native = () => {
    if (!artMethodAddress) {
        for (var symbol of Process.findModuleByName("libart.so").enumerateSymbols()) {
            let address = symbol.address
            let name = symbol.name
            let indexArtMethod = name.indexOf("ArtMethod")
            let indexInvoke = name.indexOf("Invoke")
            let indexThread = name.indexOf("Thread")
            if (indexArtMethod >= 0
                && indexInvoke >= 0
                && indexThread >= 0
                && indexArtMethod < indexInvoke
                && indexInvoke < indexThread) {
                // LOGH(name)
                artMethodAddress = address
            }
        }
    }
    if (artMethodAddress) {
        Interceptor.attach(artMethodAddress, {
            onEnter: function (args) {
                let method_name = prettyMethod(args[0], 0)
                if (!(method_name.indexOf("java.") == 0 || method_name.indexOf("android.") == 0 || method_name.indexOf("dalvik.") == 0)) {
                    var detail = Thread.backtrace(this.context, Backtracer.ACCURATE).map(DebugSymbol.fromAddress).join('\n')
                    if (saveMethodNames([method_name, detail]) < maxTimes) {
                        LOGW(`${getLine(50)}`)
                        LOGD(`\n[*] Invoke\t${method_name} { LR : ${this.context.lr}}\n             ${detail}\n`)
                    }
                }   
            }
        })
    }
}

let saveMethodNames = obj => {
    for (let index = 0; index < methodsArray.length; ++index)
        if (String(methodsArray[index][0]) == String(obj[0])) return ++methodsArray[index][2]
    methodsArray.push(obj.concat(1))
    return 1
}

var printNames = (filter, moreInfo) => {
    if (filter == undefined) filter = ""
    if (moreInfo == undefined) moreInfo = false
    Interceptor.detachAll()
    LOGW(getLine(50))
    methodsArray.forEach(item => { 
        if (filter == undefined) {
            LOGD(`[*] ${item[0]} ${moreInfo ? item[1]:""}`)
        } else if(filter != undefined && String(item[0]).indexOf(filter) != -1) {
            LOGD(`[*] ${item[0]} ${moreInfo ? item[1]:""}`)
        }
    })
    LOGW(getLine(50))
    main()
}


var LOGW = str => LOG(str, LogColor.YELLOW)
var LOGE = str => LOG(str, LogColor.RED)
var LOGD = str => LOG(str, LogColor.C36)
var LOGO = str => LOG(str, LogColor.C33)
var LOGH = str => LOG(str, LogColor.C96)
var LOG = (str, type) => {
    switch (type) {
        case LogColor.WHITE || undefined:
            console.log(str)
            break
        case LogColor.RED:
            console.error(str)
            break
        case LogColor.YELLOW:
            console.warn(str)
            break
        default:
            console.log("\x1b[" + type + "m" + str + "\x1b[0m")
            break
    }
}
var LogColor = {
    WHITE:0,RED:1,YELLOW:3,
    C31:31,C32:32,C33:33,C34:34,C35:35,C36:36,
    C41:41,C42:42,C43:43,C44:44,C45:45,C46:46,
    C90:90,C91:91,C92:92,C93:93,C94:94,C95:95,C96:96,C97:97,
    C100:100,C101:101,C102:102,C103:103,C104:104,C105:105,C106:106,C107:107
}

var getLine = (length, fillStr) => {
    fillStr = fillStr == undefined ? "-" : fillStr
    let key = length + "|" + fillStr
    if (linesMap.get(key) != null) return linesMap.get(key)
    for (var index = 0, tmpRet = ""; index < length; index++) tmpRet += fillStr
    linesMap.set(key, tmpRet)
    return tmpRet
}
