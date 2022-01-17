import AddComponent from "../../component/add/AddComponent";
import {useEffect, useState} from "react";
import PopupComponent from "../../component/tag/PopupComponent";

export default function AddContainer() {
    const [img, setImg] = useState(null);
    const [crop, setCrop] = useState(CROP);
    const [tagList, setTagList] = useState([]);
    const [tempTag, setTempTag] = useState({left: '', top: '', cont: ''})
    const [popActive, setPopActive] = useState(false);
    const [tagCont, setTagCont] = useState('');

    const onImgChange = e => {
        if (e.target.files && e.target.files.length > 0 ) {
            const reader = new FileReader();
            reader.addEventListener('load', () => {
                setImg(reader.result);
                setTagList([]);
                setCrop(CROP);
            });

            reader.readAsDataURL(e.target.files[0]);
        }
    }

    const onCropChange = (crop, percentCrop) => {
        setCrop(percentCrop);
    }

    const onRemove = (i) => {
        tagList.splice(i, 1)
        setTagList([...tagList]);
    }

    const onPopTxtChagne = e => {
        setTagCont(e.target.value);
    }

    const onPopSubmit = () => {
        const newTag = Object.assign(tempTag, {cont:tagCont});
        setTagList([...tagList, newTag]);
        setTempTag({});
        setTagCont('');
        setPopActive(false);
    }

    const onPopCacel = () => {
        setPopActive(false);
        setTagCont('');
        setTempTag({});
    }

    const onSubmit = () => {

    }


    useEffect(() => {
        const cropBoxEle = document.querySelector('.ReactCrop');
        const clickHandle = e => {
            const cropEle = document.querySelector('.ReactCrop__image');
            if (e.target === cropEle) {
                const {x, y} = crop;
                const newTag = {
                    left: `${x}%`,
                    top: `${y}%`
                };
                setTempTag(newTag);
                setPopActive(true);
            }
        };
        if (cropBoxEle) {
            cropBoxEle.addEventListener('dblclick', clickHandle);
            cropBoxEle.addEventListener('touchstart', clickHandle);
            return () => {
                cropBoxEle.removeEventListener('dblclick', clickHandle);
                cropBoxEle.removeEventListener('touchstart', clickHandle);
            }

        }
    });




    return (
        <>
            <AddComponent
                crop={crop}
                img={img}
                onCropChange={onCropChange}
                onImgChange={onImgChange}
                tagList={tagList}
                onSubmit={onSubmit}
                onRemove={onRemove}
            />
            {popActive &&
                <PopupComponent
                    onTxtChange={onPopTxtChagne}
                    onSubmit={onPopSubmit}
                    onCancel={onPopCacel}
            />}
        </>
    );
}

const CROP = {
    unit: '%',
    x: 0,
    y: 20,
    height: 0,
    width: 0
};
