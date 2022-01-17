import ReactCrop from "react-image-crop";
import TagComponent from "../tag/TagComponent";
import TagBoxComponent from "../tag/TagBoxComponent";

export default function AddComponent({crop, img, onCropChange, onImgChange, tagList, onSubmit, onRemove}) {
    return (
        <div className='innerCont'>
            <div className='imgArea'>
                <div className='imgBox'>
                    <ReactCrop crop={crop} src={img} onChange={onCropChange}/>
                    {img && tagList.map(({left, top, cont}, i) => {
                            return (<TagComponent key={i} left={left} top={top} cont={cont}/>)
                    })}
                </div>
                <div className='btnBox'>
                    <input type='file' onChange={onImgChange}/>
                </div>
            </div>
            <div className='optionArea mt50'>
                <div className='tagBox'>
                    {img && tagList.map(({cont}, i) => {
                        return (<TagBoxComponent key={i}  i={i} cont={cont} onRemove={onRemove}/>)
                    })}
                </div>
            </div>
            <div className='btnBox'>
                <button onChange={onSubmit}>확인</button>
            </div>
        </div>
    )
}