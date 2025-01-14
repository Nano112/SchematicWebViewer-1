import JSZip from 'jszip';

export interface ResourceLoader {
    getResourceBlob: (name: string) => Promise<string> | undefined;
    getResourceString: (name: string) => Promise<string> | undefined;
    clearCache: () => void;
}

async function loadZip(jarUrl: string | string[]) {
    if (Array.isArray(jarUrl)) {
        return await Promise.all(
            jarUrl.map(async url => {
                const zipFile = await (await fetch(url)).blob();
                const zip = await JSZip.loadAsync(zipFile);

                return zip;
            })
        );
    } else {
        const zipFile = await (await fetch(jarUrl)).blob();
        const zip = await JSZip.loadAsync(zipFile);

        return zip;
    }
}

export async function getResourceLoader(
    jarUrl: string | string[]
): Promise<ResourceLoader> {
    console.log(jarUrl);
    const zip = await loadZip(jarUrl);
    // console.log(zip);
    // log the content of "assets"
    const stringCache: Map<string, string> = new Map();
    const blobCache: Map<string, string> = new Map();

    const getResourceBlob = async (name: string) => {
        // log the traceback of the call
        console.log(new Error().stack);
        
        if (blobCache.has(name)) {
            return blobCache.get(name);
        } else {
            let data: Blob;
            if (Array.isArray(zip)) {

                for (const zipFile of zip) {

                    data = await zipFile
                        .file(`assets/minecraft/${name}`)
                        ?.async('blob');
                    if (data) {
                        break;
                    }
                }
                console.log(data);
            } else {
                data = await zip
                    .file(`assets/minecraft/${name}`)
                    ?.async('blob');
            }
            if (!data) {
                blobCache.set(name, undefined);
                return undefined;
            }
            const url = URL.createObjectURL(data);
            blobCache.set(name, url);
            return url;
        }
    };

    const getResourceString = async (name: string) => {
        if (stringCache.has(name)) {
            return stringCache.get(name);
        } else {
            let data: string;
            if (Array.isArray(zip)) {
                for (const zipFile of zip) {
                    data = await zipFile
                        .file(`assets/minecraft/${name}`)
                        ?.async('string');
                    if (data) {
                        break;
                    }
                }
            } else {
                data = await zip
                    .file(`assets/minecraft/${name}`)
                    ?.async('string');
            }
            stringCache.set(name, data);
            return data;
        }
    };

    const clearCache = () => {
        stringCache.clear();
        blobCache.clear();
    };

    return {
        getResourceBlob,
        getResourceString,
        clearCache,
    };
}
