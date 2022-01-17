export default function TagBoxComponent ({i, cont, onRemove}) {

    return (
        <>
            <div className='tagItem'>
                <span className='item'>{cont}</span>
                <button onClick={() => onRemove(i)}>삭제</button>
            </div>
        </>
    )
}