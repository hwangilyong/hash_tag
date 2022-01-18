export default function PopupComponent ({active, onTxtChange, onCancel, onSubmit}) {

    return (
        <>
            <div className='popArea'>
                <div className='popCont'>
                    <input type='text' onChange={onTxtChange}/>
                    <div className='btnBox'>
                        <button onClick={onCancel}>취소</button>
                        <button onClick={onSubmit}>확인</button>
                    </div>
                </div>
            </div>
        </>
    )
}