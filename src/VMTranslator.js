// VMTranslator
const fs = require("fs");
const templates = JSON.parse(fs.readFileSync(`${__dirname}/map.json`));
const segments = JSON.parse(fs.readFileSync(`${__dirname}/segments.json`));;
const filecache = {};

function loadTemplate(name) {
    if(name in filecache) return filecache[name];
    return filecache[name] = fs.readFileSync(`${__dirname}/${templates[name]}`).toString();
}

const pre = `
const js = (str,...values) => () => eval(str.join(''));
const r = (str,...values) => {
    str = Array.from(str);
    str.shift();
    let l = "";
    for(let j = 0; j < values[0];j++)
    {
        let arr = [];
        let i = 1;
        str.forEach(element => {
            arr.push(element)
            // console.log("here!");
            // console.log(typeof values[i] == "function"?values[i]():values[i]);
            values[i]? arr.push(typeof values[i] == "function"?values[i++]():values[i++]):0
        });
        l += '\\n' + arr.join('');
    }
    return l;
};`;

function generate(tem,params) {
    if(tem in templates) {
        const inherit = (tem,updates={}) => generate(tem,Object.assign({},params,updates));
        const template = loadTemplate(tem);
        const vars = Object.keys(params)
        .reduce((str,key) => str + `let ${key} = ${typeof params[key] == "string"?`"${params[key]}"`:params[key]};`,"");
        return eval(pre + vars + "`" + template + "\n`");
    }
    throw new Error("No such template");
}

function createCommand(command,...params) {
    return { type:command, params:params };
}

function parse(code) {
    return  code.trim()
            .split("\n")
            .map(line => line.trim())
            .filter(line => !line.startsWith("//"))
            .map(line => line.split("//")[0].trim())
            .filter(line => !line.length == 0)
            .map(line => createCommand(...line.split(" ")));
}

const codeGen = {
    "push": (params) => {
        if(params[0] == "constant") return generate("constant", { number:params[1] });
        else if(params[0] == "static") return generate("staticread", { offset:params[1], filename:params[2].filename });
        else if(params[0] == "pointer") return generate("pread", { segment: segments[parseInt(params[1])?"that":"this"] });
        return generate("segread", { segment: segments[params[0]], offset:params[1] });
    },
    "pop": (params) => {
        if(params[0] == "static") return generate("staticwrite", { offset:params[1], filename:params[2].filename });
        else if(params[0] == "pointer") return generate("pwrite", { segment: segments[parseInt(params[1])?"that":"this"] });
        return generate("segwrite", { segment: segments[params[0]], offset:params[1] });
    },
    "add": () => generate("binop", { op:"+" }),
    "sub": () => generate("binop", { op:"-" }),
    "and": () => generate("binop", { op:"&" }),
    "or": () => generate("binop", { op:"|" }),
    "lt": (params) => generate("boolop", { op:"JLT", label1:`${params[0].filename.toUpperCase()}.$NEXT${params[0].counter++}`, label2:`${params[0].filename.toUpperCase()}.$END${params[0].counter++}` }),
    "gt": (params) => generate("boolop", { op:"JGT", label1:`${params[0].filename.toUpperCase()}.$NEXT${params[0].counter++}`, label2:`${params[0].filename.toUpperCase()}.$END${params[0].counter++}` }),
    "eq": (params) => generate("boolop", { op:"JEQ", label1:`${params[0].filename.toUpperCase()}.$NEXT${params[0].counter++}`, label2:`${params[0].filename.toUpperCase()}.$END${params[0].counter++}` }),
    "neg": () => generate("unop", { op:"-" }),
    "not": () => generate("unop", { op:"!" }),
    "label": (params) => generate("label", { label:`${params[1].infunc?`${params[1].infunc}$`:""}${params[0]}` }),
    "goto": (params) => generate("goto", { label:`${params[1].infunc?`${params[1].infunc}$`:""}${params[0]}` }),
    "if-goto": (params) => generate("if-goto", { label:`${params[1].infunc?`${params[1].infunc}$`:""}${params[0]}` }),
    "function":(params) => generate("function", { functionname:`${params[0]}`, nargs:params[1] }),//${params[2].filename}.
    "call":(params) => generate("call", { functionname:params[0], nargs:params[1], returnaddr:`${params[2].infunc}$ret.${params[2].fc++}` }),
    "return":(params) => generate("return", {})
}

function removeNL(asm) {
    return asm.trim()
            .split("\n")
            .map(line => line.trim())
            .filter(line => !line.length == 0)
            .join("\n");
}

function translate(commands,filename) { 
    const props = {
        counter:0,
        fc:0,
        infunc:"",
        filename:filename
    };
    const prev = [["",0]];
    return commands.reduce((asm,comm) => {
        comm.params.push(props);
        console.log(prev);
        if(comm.type == "function") {
            props.infunc = comm.params[0];
            props.fc = 0;
            prev.push([props.infunc,props.fc]);
        }
        else if(comm.type == "return") {
            const ch = prev.pop();
            props.infunc = ch[0];
            props.fc = ch[1];
        }
        const code = asm + codeGen[comm.type](comm.params);
        return code;
    }, "");
}

function aggregateTranslate(files) {
    const startup = generate("startup", { addr:segments["SP"], functionname:"Sys.init", nargs:0 });
    return files.reduce((prev,file) => prev + translate(file.code,file.name), startup);
}

function main(args) {
    if(fs.existsSync(args[0]) && fs.lstatSync(args[0]).isDirectory()) {
        const files = fs.readdirSync(args[0]).filter(f => f.endsWith(".vm"));
        const path = args[0].endsWith("/")?args[0]:`${args[0]}/`;
        console.log("Reading...");
        const data = files.map(file => {
            const filename = file.split(".")[0];
            const code = fs.readFileSync(`${path}${file}`).toString();
            return {
                name: filename,
                code: parse(code)
            };
        });
        console.log("Compiling...");
        const asm = aggregateTranslate(data);
        const dirs = path.split("/");
        const filename = dirs[dirs.length-2];
        dirs.pop();
        fs.writeFileSync(`${dirs.join("/")}/${filename}.asm`, removeNL(asm));
        console.log("Compiled to Assembly.");
    }
    else {
        console.log("Reading...");
        const dirs = args[0].split("/");
        const filename = dirs[dirs.length-1].split(".")[0];
        const code = fs.readFileSync(args[0]).toString();
        const asm = translate(parse(code),filename);
        console.log("Compiling...");
        dirs.pop();
        fs.writeFileSync(`${dirs.join("/")}/${filename}.asm`, removeNL(asm));
        console.log("Compiled to Assembly.");
    }
}

main(process.argv.slice(2));